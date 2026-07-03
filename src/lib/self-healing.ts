/**
 * Self-Healing Foundation
 *
 * Detects common failure states and applies safe automated recovery.
 * All actions are logged to self_healing_log.
 * Never makes destructive changes — only resets stale state.
 *
 * Currently handles:
 *   - Stale processing jobs (stuck > 10 min)
 *   - Expired response cache cleanup
 *   - Overdue promise follow-ups flagging
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('self-healing')

export interface HealingResult {
  trigger:  string
  action:   string
  status:   'applied' | 'failed' | 'skipped'
  detail?:  string
}

/** Recover stale jobs stuck in 'processing' state */
async function healStaleJobs(companyId?: string): Promise<HealingResult> {
  const trigger = 'stale_processing_jobs'
  const tenMinsAgo = new Date(Date.now() - 10 * 60_000).toISOString()
  try {
    const sb = createServiceClient()
    const q  = sb.from('job_queue')
      .update({
        status:    'retrying',
        last_error: 'Self-healed: recovered from stale processing state',
      })
      .eq('status', 'processing')
      .lt('started_at', tenMinsAgo)
    if (companyId) q.eq('company_id', companyId)
    // Real gap found during a full-system audit: discarded `error` entirely
    // (only destructured `count`) — a failed update was misreported as
    // status:'applied', detail:'Reset 0 jobs' instead of a real failure.
    const { count, error } = await q.select('id', { count: 'exact' })
    if (error) return { trigger, action: 'reset_stale_jobs', status: 'failed', detail: error.message }

    const result: HealingResult = {
      trigger, action: 'reset_stale_jobs',
      status: 'applied', detail: `Reset ${count ?? 0} stale jobs`,
    }
    if ((count ?? 0) > 0) await logHealing(result, companyId)
    return result
  } catch (err) {
    return { trigger, action: 'reset_stale_jobs', status: 'failed',
             detail: err instanceof Error ? err.message : 'Unknown' }
  }
}

/** Clean expired response cache entries */
async function healExpiredCache(): Promise<HealingResult> {
  const trigger = 'expired_response_cache'
  try {
    const sb  = createServiceClient()
    try {
      await sb.rpc('cleanup_response_cache')
      return { trigger, action: 'cleanup_cache', status: 'applied', detail: 'Cache cleanup RPC called' }
    } catch {
      // Fallback to direct delete
      const { count } = await sb.from('response_cache')
        .delete()
        .lt('expires_at', new Date().toISOString())
        .select('id', { count: 'exact' })
      return { trigger, action: 'cleanup_cache', status: 'applied', detail: `Removed ${count ?? 0} expired entries` }
    }
  } catch (err) {
    return { trigger, action: 'cleanup_cache', status: 'failed',
             detail: err instanceof Error ? err.message : 'Unknown' }
  }
}

/** Flag promises that are overdue and still 'pending' */
async function healOverduePromises(companyId?: string): Promise<HealingResult> {
  const trigger = 'overdue_promises'
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  try {
    const sb = createServiceClient()
    const q  = sb.from('promises')
      .update({ status: 'broken' })
      .eq('status', 'pending')
      .lt('promised_date', yesterday)
    if (companyId) q.eq('company_id', companyId)
    // Real gap found during a full-system audit: discarded `error` entirely
    // — same class as healStaleJobs above.
    const { count, error } = await q.select('id', { count: 'exact' })
    if (error) return { trigger, action: 'mark_broken_promises', status: 'failed', detail: error.message }

    const result: HealingResult = {
      trigger, action: 'mark_broken_promises',
      status: 'applied', detail: `Marked ${count ?? 0} overdue promises as broken`,
    }
    if ((count ?? 0) > 0) await logHealing(result, companyId)
    return result
  } catch (err) {
    return { trigger, action: 'mark_broken_promises', status: 'failed',
             detail: err instanceof Error ? err.message : 'Unknown' }
  }
}

async function logHealing(result: HealingResult, companyId?: string): Promise<void> {
  try {
    const sb = createServiceClient()
    await sb.from('self_healing_log').insert({
      company_id:    companyId ?? null,
      trigger_event: result.trigger,
      healing_action: result.action,
      status:        result.status,
      after_state:   { detail: result.detail },
    })
  } catch { /* non-critical */ }
}

/**
 * Run all self-healing routines.
 * Safe to call on every job-worker tick.
 */
export async function runSelfHealing(companyId?: string): Promise<HealingResult[]> {
  const results = await Promise.allSettled([
    healStaleJobs(companyId),
    healExpiredCache(),
    healOverduePromises(companyId),
  ])

  const out = results.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : { trigger: 'unknown', action: 'unknown', status: 'failed' as const, detail: 'Threw unexpectedly' }
  )

  const applied = out.filter(r => r.status === 'applied' && r.detail?.includes('0') === false).length
  if (applied > 0) log.info('Self-healing applied', { applied, company_id: companyId })

  return out
}
