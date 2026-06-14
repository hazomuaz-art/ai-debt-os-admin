/**
 * Usage Tracker
 *
 * Tracks every significant action for:
 *   - Cost shield / limit enforcement
 *   - SaaS billing preparation
 *   - Platform analytics
 *
 * All operations are fire-and-forget — they never block the main flow.
 * A failure here MUST NOT break the feature being tracked.
 *
 * Usage:
 *   import { trackEvent, trackAIAction, trackMessage } from '@/lib/usage-tracker'
 *
 *   // In an API route or server action:
 *   await trackEvent({ company_id: '...', event_type: 'ai_action', user_id: '...' })
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('usage-tracker')

// ── Types ─────────────────────────────────────────────────────────────────

export type UsageEventType =
  | 'ai_action'
  | 'message_sent'
  | 'campaign_sent'
  | 'debt_created'
  | 'customer_created'
  | 'user_invited'
  | 'whatsapp_sent'
  | 'call_initiated'
  | 'response_cache_hit'
  | 'response_template_hit'
  | 'response_memory_hit'
  | 'openai_call'
  | 'score_generated'

// Map event types to the tenant_usage column they increment
const EVENT_TO_COLUMN: Partial<Record<UsageEventType, string>> = {
  ai_action:              'ai_calls_used',
  openai_call:            'ai_openai_calls',
  score_generated:        'ai_openai_calls',
  message_sent:           'messages_count',
  whatsapp_sent:          'whatsapp_sent',
  campaign_sent:          'campaigns_count',
  debt_created:           'debts_count',
  customer_created:       'customers_count',
  user_invited:           'users_count',
  response_cache_hit:     'ai_cache_hits',
  response_template_hit:  'ai_template_hits',
  response_memory_hit:    'ai_memory_hits',
}

export interface TrackEventOptions {
  company_id:  string
  event_type:  UsageEventType
  user_id?:    string
  debt_id?:    string
  customer_id?: string
  cost_usd?:   number
  metadata?:   Record<string, unknown>
}

// ── Core tracker ──────────────────────────────────────────────────────────

/**
 * Track a single usage event.
 * Inserts into usage_events AND increments the tenant_usage aggregate.
 * Non-blocking: errors are logged but never thrown.
 */
export async function trackEvent(opts: TrackEventOptions): Promise<void> {
  try {
    const supabase = createServiceClient()
    const period   = new Date().toISOString().slice(0, 7) // YYYY-MM

    // 1. Insert granular event record
    const { error: insertErr } = await supabase
      .from('usage_events')
      .insert({
        company_id:  opts.company_id,
        event_type:  opts.event_type,
        user_id:     opts.user_id  ?? null,
        debt_id:     opts.debt_id  ?? null,
        customer_id: opts.customer_id ?? null,
        metadata:    { ...(opts.metadata ?? {}), ...(opts.cost_usd ? { cost_usd: opts.cost_usd } : {}) },
      })

    if (insertErr) {
      log.warn('usage_events insert failed', insertErr)
    }

    // 2. Increment the corresponding tenant_usage aggregate column
    const column = EVENT_TO_COLUMN[opts.event_type]
    if (column) {
      try {
        await supabase.rpc('increment_usage', {
          p_company_id: opts.company_id,
          p_period:     period,
          p_field:      column,
          p_amount:     1,
        })
      } catch {
        // Function may not be deployed yet — silent skip
      }
    }
  } catch (err) {
    // Never throw — usage tracking is non-critical
    log.warn('trackEvent failed silently: ' + (err instanceof Error ? err.message : String(err)))
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────

export function trackAIAction(opts: { company_id: string; user_id?: string; debt_id?: string }) {
  return trackEvent({ ...opts, event_type: 'ai_action' })
}

export function trackOpenAICall(opts: {
  company_id: string
  model?:     string
  cost_usd?:  number
  debt_id?:   string
}) {
  return trackEvent({
    ...opts,
    event_type: 'openai_call',
    metadata:   { model: opts.model },
  })
}

export function trackMessage(opts: {
  company_id: string
  channel:    'whatsapp' | 'email' | 'sms' | 'call' | 'other'
  user_id?:   string
  customer_id?: string
}) {
  const event: UsageEventType = opts.channel === 'whatsapp' ? 'whatsapp_sent' : 'message_sent'
  return trackEvent({ ...opts, event_type: event })
}

export function trackDebtCreated(opts: { company_id: string; user_id?: string; debt_id?: string }) {
  return trackEvent({ ...opts, event_type: 'debt_created' })
}

export function trackCustomerCreated(opts: { company_id: string; user_id?: string; customer_id?: string }) {
  return trackEvent({ ...opts, event_type: 'customer_created' })
}

export function trackUserInvited(opts: { company_id: string; user_id?: string }) {
  return trackEvent({ ...opts, event_type: 'user_invited' })
}

export function trackResponseHit(opts: {
  company_id: string
  source: 'cache' | 'template' | 'memory'
  customer_id?: string
}) {
  const event: UsageEventType =
    opts.source === 'cache'    ? 'response_cache_hit'    :
    opts.source === 'template' ? 'response_template_hit' :
    'response_memory_hit'
  return trackEvent({ ...opts, event_type: event })
}

// ── Limit checking ────────────────────────────────────────────────────────

export interface UsageLimits {
  daily_ai_calls_limit:      number
  daily_whatsapp_limit:      number
  daily_call_analysis_limit: number
  monthly_cost_limit:        number
}

export interface UsageCheckResult {
  allowed:    boolean
  reason?:    string
  current?:   number
  limit?:     number
}

/**
 * Check if a company has exceeded its AI call limit for today.
 * Returns { allowed: true } if under limit or if system_config is not found.
 */
export async function checkAICallLimit(companyId: string): Promise<UsageCheckResult> {
  try {
    const supabase = createServiceClient()
    const today    = new Date().toISOString().split('T')[0]

    // Get today's usage
    const { count } = await supabase
      .from('usage_events')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('event_type', 'openai_call')
      .gte('created_at', `${today}T00:00:00Z`)

    // Get company limit
    const { data: config } = await supabase
      .from('system_config')
      .select('daily_ai_calls_limit, emergency_stop_all, emergency_stop_ai')
      .eq('company_id', companyId)
      .maybeSingle()

    if (config?.emergency_stop_all || config?.emergency_stop_ai) {
      return { allowed: false, reason: 'Emergency stop is active' }
    }

    const limit   = config?.daily_ai_calls_limit ?? 1000
    const current = count ?? 0

    if (current >= limit) {
      return { allowed: false, reason: 'Daily AI call limit reached', current, limit }
    }

    return { allowed: true, current, limit }
  } catch {
    // If check fails, allow (non-critical)
    return { allowed: true }
  }
}

/**
 * Check if a company has exceeded its WhatsApp message limit for today.
 */
export async function checkWhatsAppLimit(companyId: string): Promise<UsageCheckResult> {
  try {
    const supabase = createServiceClient()
    const today    = new Date().toISOString().split('T')[0]

    const { count } = await supabase
      .from('usage_events')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('event_type', 'whatsapp_sent')
      .gte('created_at', `${today}T00:00:00Z`)

    const { data: config } = await supabase
      .from('system_config')
      .select('daily_whatsapp_limit, emergency_stop_all, emergency_stop_whatsapp')
      .eq('company_id', companyId)
      .maybeSingle()

    if (config?.emergency_stop_all || config?.emergency_stop_whatsapp) {
      return { allowed: false, reason: 'Emergency stop is active' }
    }

    const limit   = config?.daily_whatsapp_limit ?? 5000
    const current = count ?? 0

    if (current >= limit) {
      return { allowed: false, reason: 'Daily WhatsApp limit reached', current, limit }
    }

    return { allowed: true, current, limit }
  } catch {
    return { allowed: true }
  }
}

/**
 * Get a summary of current month's usage for a company.
 * Used by the Cost Center and Platform Admin pages.
 */
export async function getUsageSummary(companyId: string): Promise<{
  period:          string
  ai_calls_used:   number
  messages_count:  number
  whatsapp_sent:   number
  campaigns_count: number
  debts_count:     number
  customers_count: number
  users_count:     number
  ai_cache_hits:   number
  ai_template_hits: number
  ai_memory_hits:  number
  ai_openai_calls: number
  cache_hit_rate:  number  // % of AI requests served from cache/template/memory
} | null> {
  try {
    const supabase = createServiceClient()
    const period   = new Date().toISOString().slice(0, 7)

    const { data } = await supabase
      .from('tenant_usage')
      .select('*')
      .eq('company_id', companyId)
      .eq('period', period)
      .maybeSingle()

    if (!data) return null

    const d = data as Record<string, number>
    const totalAI  = (d.ai_cache_hits ?? 0) + (d.ai_template_hits ?? 0) +
                     (d.ai_memory_hits ?? 0) + (d.ai_openai_calls ?? 0)
    const savedAI  = (d.ai_cache_hits ?? 0) + (d.ai_template_hits ?? 0) +
                     (d.ai_memory_hits ?? 0)
    const cacheHitRate = totalAI > 0 ? Math.round((savedAI / totalAI) * 100) : 0

    return {
      period,
      ai_calls_used:    d.ai_calls_used    ?? 0,
      messages_count:   d.messages_count   ?? 0,
      whatsapp_sent:    d.whatsapp_sent     ?? 0,
      campaigns_count:  d.campaigns_count  ?? 0,
      debts_count:      d.debts_count      ?? 0,
      customers_count:  d.customers_count  ?? 0,
      users_count:      d.users_count      ?? 0,
      ai_cache_hits:    d.ai_cache_hits    ?? 0,
      ai_template_hits: d.ai_template_hits ?? 0,
      ai_memory_hits:   d.ai_memory_hits   ?? 0,
      ai_openai_calls:  d.ai_openai_calls  ?? 0,
      cache_hit_rate:   cacheHitRate,
    }
  } catch {
    return null
  }
}
