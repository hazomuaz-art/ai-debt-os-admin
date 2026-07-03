/**
 * Limit Enforcement Foundation
 *
 * Resolves the effective limit for any feature, compares with current
 * usage, and logs the enforcement decision.
 *
 * Priority for fallback when limit is hit:
 *   1. rules engine   (system_config.limit_fallback = 'rules')
 *   2. memory cache   (limit_fallback = 'memory')
 *   3. manual only    (limit_fallback = 'manual')
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('limit-enforcement')

export type LimitType =
  | 'daily_ai_actions'
  | 'daily_openai_calls'
  | 'monthly_whatsapp'
  | 'monthly_messages'
  | 'max_users'
  | 'max_customers'
  | 'max_debts'
  | 'max_campaigns'

export type EnforcementAction = 'allowed' | 'blocked' | 'degraded'

export interface EnforcementResult {
  action:      EnforcementAction
  current:     number
  limit:       number
  pct:         number
  fallback?:   string
  reason?:     string
}

async function getEffectiveLimit(companyId: string, limitType: LimitType): Promise<number> {
  try {
    const sb = createServiceClient()
    const { data } = await sb.rpc('get_company_limits', { p_company_id: companyId })
    if (data && typeof data === 'object') {
      const val = (data as Record<string, unknown>)[limitType]
      if (typeof val === 'number') return val
    }
  } catch { /* fallback */ }

  // Hard defaults if RPC unavailable
  const defaults: Record<LimitType, number> = {
    daily_ai_actions: 100, daily_openai_calls: 50,
    monthly_whatsapp: 2000, monthly_messages: 5000,
    max_users: 10, max_customers: 5000,
    max_debts: 5000, max_campaigns: 5,
  }
  return defaults[limitType] ?? 100
}

async function getCurrentUsage(companyId: string, limitType: LimitType): Promise<number> {
  try {
    const sb      = createServiceClient()
    const today   = new Date().toISOString().split('T')[0]
    const month   = new Date().toISOString().slice(0, 7)

    if (limitType === 'daily_ai_actions' || limitType === 'daily_openai_calls') {
      const evtType = limitType === 'daily_ai_actions' ? 'ai_action' : 'openai_call'
      const { count } = await sb
        .from('usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('event_type', evtType)
        .gte('created_at', `${today}T00:00:00Z`)
      return count ?? 0
    }

    if (limitType === 'monthly_whatsapp') {
      const { count } = await sb
        .from('usage_events')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('event_type', 'whatsapp_sent')
        .gte('created_at', `${month}-01T00:00:00Z`)
      return count ?? 0
    }

    if (limitType === 'max_users') {
      const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
      return count ?? 0
    }
    if (limitType === 'max_customers') {
      const { count } = await sb.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
      return count ?? 0
    }
    if (limitType === 'max_debts') {
      const { count } = await sb.from('debts').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
      return count ?? 0
    }
  } catch { /* fallback */ }
  return 0
}

/**
 * Check whether a given operation is allowed for a company.
 * Logs the decision to limit_enforcement_log (non-blocking).
 */
export async function checkLimit(
  companyId: string,
  limitType: LimitType,
): Promise<EnforcementResult> {
  try {
    const [limit, current] = await Promise.all([
      getEffectiveLimit(companyId, limitType),
      getCurrentUsage(companyId, limitType),
    ])

    const pct    = limit > 0 ? Math.round((current / limit) * 100) : 0
    const action: EnforcementAction =
      current >= limit ? 'blocked' :
      pct >= 90        ? 'degraded' : 'allowed'

    let fallback: string | undefined
    if (action !== 'allowed') {
      try {
        const sb = createServiceClient()
        const { data: cfg } = await sb
          .from('system_config')
          .select('limit_fallback')
          .eq('company_id', companyId)
          .maybeSingle()
        fallback = String((cfg as Record<string,unknown> | null)?.limit_fallback ?? 'rules')
      } catch { fallback = 'rules' }
    }

    // Log non-blocking
    void logEnforcement(companyId, limitType, action, current, limit, fallback)

    return {
      action,
      current,
      limit,
      pct,
      fallback,
      reason: action === 'blocked'
        ? `${limitType} limit reached (${current}/${limit})`
        : action === 'degraded'
          ? `${limitType} at ${pct}% — degraded mode`
          : undefined,
    }
  } catch (err) {
    log.warn('checkLimit failed: ' + (err instanceof Error ? err.message : String(err)))
    return { action: 'allowed', current: 0, limit: 999999, pct: 0 }
  }
}

async function logEnforcement(
  companyId: string,
  limitType: string,
  action: string,
  current: number,
  limitVal: number,
  fallback?: string,
): Promise<void> {
  try {
    const sb = createServiceClient()
    const { error: enforcementLogErr } = await sb.from('limit_enforcement_log').insert({
      company_id: companyId,
      limit_type: limitType,
      action_type: action,
      current_val: current,
      limit_val:   limitVal,
      fallback:    fallback ?? null,
    })
    if (enforcementLogErr) log.warn('limit_enforcement_log insert failed: ' + enforcementLogErr.message)
  } catch { /* non-critical */ }
}
