/**
 * Monitoring + Audit Foundation
 *
 * Provides:
 *   runHealthChecks()  — checks OpenAI, WhatsApp, DB, job queue
 *   getHealthStatus()  — latest status per check type
 *   writeAuditLog()    — structured audit trail entry
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('monitoring')

export type CheckType = 'openai' | 'whatsapp' | 'supabase' | 'job_queue' | 'rate_limits' | 'memory' | 'rules' | 'overall'
export type HealthStatus = 'ok' | 'degraded' | 'down' | 'unknown'

export interface HealthResult {
  check_type:  CheckType
  status:      HealthStatus
  latency_ms?: number
  message?:    string
}

/** Probe the DB itself — simplest possible liveness check */
async function checkSupabase(): Promise<HealthResult> {
  const start = Date.now()
  try {
    const sb = createServiceClient()
    await sb.from('companies').select('id').limit(1)
    return { check_type: 'supabase', status: 'ok', latency_ms: Date.now() - start }
  } catch (err) {
    return {
      check_type: 'supabase', status: 'down',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'DB unreachable',
    }
  }
}

/** Check job queue health (stale jobs = degraded) */
async function checkJobQueue(companyId?: string): Promise<HealthResult> {
  const start = Date.now()
  try {
    const sb = createServiceClient()
    const tenMinsAgo = new Date(Date.now() - 10 * 60_000).toISOString()
    const q = sb.from('job_queue').select('id', { count: 'exact', head: true })
      .eq('status', 'processing')
      .lt('started_at', tenMinsAgo)
    if (companyId) q.eq('company_id', companyId)
    const { count } = await q
    const stale = count ?? 0
    return {
      check_type: 'job_queue',
      status:     stale > 5 ? 'degraded' : 'ok',
      latency_ms: Date.now() - start,
      message:    stale > 0 ? `${stale} stale jobs` : undefined,
    }
  } catch (err) {
    return {
      check_type: 'job_queue', status: 'unknown',
      latency_ms: Date.now() - start,
      message: err instanceof Error ? err.message : 'Check failed',
    }
  }
}

/** Check if OpenAI API key is configured (no live call to save cost) */
function checkOpenAI(): HealthResult {
  const configured = !!process.env.OPENROUTER_API_KEY
  return {
    check_type: 'openai',
    status:     configured ? 'ok' : 'down',
    message:    configured ? 'API key present' : 'OPENROUTER_API_KEY not set',
  }
}

/** Check if WhatsApp env vars are configured */
function checkWhatsApp(): HealthResult {
  const configured = !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN)
  return {
    check_type: 'whatsapp',
    status:     configured ? 'ok' : 'degraded',
    message:    configured ? 'Credentials present' : 'WhatsApp not configured',
  }
}

/** Run all health checks and persist results */
export async function runHealthChecks(companyId?: string): Promise<HealthResult[]> {
  const checks = await Promise.allSettled([
    checkSupabase(),
    checkJobQueue(companyId),
    Promise.resolve(checkOpenAI()),
    Promise.resolve(checkWhatsApp()),
  ])

  const results: HealthResult[] = checks.map(c =>
    c.status === 'fulfilled'
      ? c.value
      : { check_type: 'overall' as CheckType, status: 'unknown' as HealthStatus, message: 'Check threw' }
  )

  // Derive overall
  const worst: HealthStatus =
    results.some(r => r.status === 'down')     ? 'down'     :
    results.some(r => r.status === 'degraded') ? 'degraded' : 'ok'
  results.push({ check_type: 'overall', status: worst })

  // Persist (non-blocking)
  void persistHealthChecks(results, companyId)

  return results
}

async function persistHealthChecks(results: HealthResult[], companyId?: string): Promise<void> {
  try {
    const sb = createServiceClient()
    await sb.from('health_checks').insert(
      results.map(r => ({
        company_id: companyId ?? null,
        check_type: r.check_type,
        status:     r.status,
        latency_ms: r.latency_ms ?? null,
        message:    r.message    ?? null,
      }))
    )
  } catch { /* non-critical */ }
}

/** Get the latest status for each check type */
export async function getHealthStatus(companyId?: string): Promise<Record<string, HealthResult>> {
  try {
    const sb  = createServiceClient()
    const q   = sb.from('health_checks').select('check_type, status, latency_ms, message, checked_at')
      .order('checked_at', { ascending: false })
      .limit(100)
    if (companyId) q.or(`company_id.eq.${companyId},company_id.is.null`)
    const { data } = await q
    if (!data) return {}

    const latest: Record<string, HealthResult> = {}
    for (const row of data as Array<{ check_type: string; status: string; latency_ms: number | null; message: string | null }>) {
      if (!latest[row.check_type]) {
        latest[row.check_type] = {
          check_type: row.check_type as CheckType,
          status:     row.status     as HealthStatus,
          latency_ms: row.latency_ms ?? undefined,
          message:    row.message    ?? undefined,
        }
      }
    }
    return latest
  } catch {
    return {}
  }
}

/** Write a structured audit log entry */
export async function writeAuditLog(opts: {
  company_id?:  string
  actor_id?:    string
  actor_email?: string
  action:       string
  resource:     string
  resource_id?: string
  old_data?:    Record<string, unknown>
  new_data?:    Record<string, unknown>
  ip_address?:  string
  user_agent?:  string
}): Promise<void> {
  try {
    const sb = createServiceClient()
    await sb.from('audit_log').insert({
      company_id:  opts.company_id  ?? null,
      actor_id:    opts.actor_id    ?? null,
      actor_email: opts.actor_email ?? null,
      action:      opts.action,
      resource:    opts.resource,
      resource_id: opts.resource_id ?? null,
      old_data:    opts.old_data    ?? null,
      new_data:    opts.new_data    ?? null,
      ip_address:  opts.ip_address  ?? null,
      user_agent:  opts.user_agent  ?? null,
    })
  } catch (err) {
    log.warn('writeAuditLog failed: ' + (err instanceof Error ? err.message : String(err)))
  }
}
