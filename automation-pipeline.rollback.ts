/**
 * Automation Pipeline â€” Production Orchestrator
 *
 * Single source of truth for all module orchestration.
 * Called synchronously from import, sync, webhook, and manual triggers.
 *
 * Mode contract:
 *   ALL modes  â†’ load context, timeline, ai_memory, ai_score, rules, alerts, promises, approvals, campaigns
 *   test+live  â†’ also create ai_actions (status='pending')
 *   live only  â†’ also queue WhatsApp messages
 *   emergency_stop â†’ skip everything, return immediately
 *
 * Skip criteria (hard skip, not soft):
 *   - status in: settled, paid, closed, written_off, cancelled + Arabic equivalents
 *   - current_balance <= 0
 *
 * Every step is wrapped in try/catch; a failing step never blocks later steps.
 * Every step logs its result for debugging.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { scoreDebt, scoringFallback, type ScoreResult } from '@/lib/ai-engine'
import { calculateDaysOverdue } from '@/lib/utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('automation-pipeline')

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Public types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type EventSource =
  | 'csv_import' | 'excel_import' | 'api_sync'
  | 'webhook_whatsapp' | 'webhook_call'
  | 'payment_update' | 'promise_update' | 'collector_note'
  | 'debt_update' | 'customer_update' | 'manual'

export interface PipelineEvent {
  source:        EventSource
  company_id:    string
  actor_id?:     string
  // Resolved IDs (preferred) or raw IDs from the trigger
  _customer_id?: string
  _debt_id?:     string
  customer_id?:  string
  debt_id?:      string
  // Extra data from the triggering event
  data?:         Record<string, unknown>
}

export interface PipelineResult {
  success:          boolean
  debt_id?:         string
  customer_id?:     string
  mode:             string
  ai_score?:        number
  ai_risk?:         string
  ai_actions_count: number
  alerts_count:     number
  memory_count:     number
  steps_completed:  string[]
  steps_skipped:    string[]
  steps_failed:     string[]
  error?:           string
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Internal types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface Cfg {
  mode:          'off' | 'test' | 'live'
  emergency:     boolean
  emergency_wa:  boolean
}

interface Debt {
  id:              string
  company_id:      string
  customer_id:     string
  status:          string
  current_balance: number
  original_amount: number
  currency:        string
  due_date:        string | null
  notes:           string | null
  last_contact_result: string | null
  priority:        string
  product_type:    string | null
  reference_number: string
}

interface Customer {
  id:             string
  full_name:      string
  phone:          string | null
  whatsapp:       string | null
  national_id:    string | null
  monthly_income: number | null
  employer:       string | null
}

interface Ctx {
  debt:     Debt
  customer: Customer
  payments: Array<{ amount: number; date: string; status: string }>
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Terminal status check
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TERMINAL = new Set([
  'settled', 'paid', 'closed', 'written_off', 'cancelled',
  'Ù…Ø³Ø¯Ø¯', 'Ù…ØºÙ„Ù‚', 'Ù…Ù†ØªÙ‡ÙŠ',
])

function isTerminal(status: string, balance: number): boolean {
  if (balance <= 0) return true
  const s = status.toLowerCase().trim()
  return TERMINAL.has(s) || s.includes('settled') || s.includes('paid') ||
         s.includes('closed') || s.includes('written')
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Config loader (60-second cache)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const _cfgCache = new Map<string, { v: Cfg; exp: number }>()

async function getConfig(companyId: string): Promise<Cfg> {
  const hit = _cfgCache.get(companyId)
  if (hit && hit.exp > Date.now()) return hit.v

  const fallback: Cfg = { mode: 'off', emergency: false, emergency_wa: false }
  try {
    const { data } = await createServiceClient()
      .from('system_config')
      .select('automation_mode,emergency_stop_all,emergency_stop_ai,emergency_stop_whatsapp')
      .eq('company_id', companyId)
      .maybeSingle()

    if (!data) {
      _cfgCache.set(companyId, { v: fallback, exp: Date.now() + 60_000 })
      return fallback
    }

    const d = data as Record<string, unknown>
    const v: Cfg = {
      mode:         (['off','test','live'].includes(String(d.automation_mode)) ? d.automation_mode : 'off') as Cfg['mode'],
      emergency:    !!(d.emergency_stop_all) || !!(d.emergency_stop_ai),
      emergency_wa: !!(d.emergency_stop_all) || !!(d.emergency_stop_whatsapp),
    }
    _cfgCache.set(companyId, { v, exp: Date.now() + 60_000 })
    return v
  } catch {
    return fallback
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Context loader
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function loadCtx(debtId: string, companyId: string): Promise<Ctx | null> {
  try {
    const sb = createServiceClient()
    const [dr, pr] = await Promise.all([
      sb.from('debts')
        .select('id,company_id,customer_id,status,current_balance,original_amount,currency,due_date,notes,last_contact_result,priority,product_type,reference_number,customer:customers(id,full_name,phone,whatsapp,national_id,monthly_income,employer)')
        .eq('id', debtId).eq('company_id', companyId).single(),
      sb.from('payments')
        .select('amount,payment_date,status')
        .eq('debt_id', debtId)
        .order('payment_date', { ascending: false })
        .limit(10),
    ])
    if (dr.error || !dr.data) return null
    const d = dr.data as Record<string, unknown>
    const c = d.customer as Record<string, unknown>
    return {
      debt: {
        id:              String(d.id),
        company_id:      String(d.company_id),
        customer_id:     String(d.customer_id),
        status:          String(d.status ?? 'active'),
        current_balance: Number(d.current_balance ?? 0),
        original_amount: Number(d.original_amount ?? 0),
        currency:        String(d.currency ?? 'SAR'),
        due_date:        (d.due_date as string | null) ?? null,
        notes:           (d.notes as string | null) ?? null,
        last_contact_result: (d.last_contact_result as string | null) ?? null,
        priority:        String(d.priority ?? 'medium'),
        product_type:    (d.product_type as string | null) ?? null,
        reference_number: String(d.reference_number ?? ''),
      },
      customer: {
        id:             String(c?.id ?? ''),
        full_name:      String(c?.full_name ?? ''),
        phone:          (c?.phone as string | null) ?? null,
        whatsapp:       (c?.whatsapp as string | null) ?? null,
        national_id:    (c?.national_id as string | null) ?? null,
        monthly_income: c?.monthly_income ? Number(c.monthly_income) : null,
        employer:       (c?.employer as string | null) ?? null,
      },
      payments: (pr.data ?? []).map((p: Record<string,unknown>) => {
        const r = p as Record<string, unknown>
        return { amount: Number(r.amount ?? 0), date: String(r.payment_date ?? ''), status: String(r.status ?? '') }
      }),
    }
  } catch (err) {
    log.warn('loadCtx failed: ' + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: Timeline event
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const EVENT_TYPE_MAP: Record<EventSource, string> = {
  csv_import: 'status_change', excel_import: 'status_change', api_sync: 'status_change',
  webhook_whatsapp: 'whatsapp_in', webhook_call: 'call_in',
  payment_update: 'payment', promise_update: 'status_change',
  collector_note: 'collector_note', debt_update: 'status_change',
  customer_update: 'status_change', manual: 'ai_analysis',
}

const CHANNEL_MAP: Record<EventSource, string> = {
  csv_import: 'system', excel_import: 'system', api_sync: 'system',
  webhook_whatsapp: 'whatsapp', webhook_call: 'call',
  payment_update: 'system', promise_update: 'system',
  collector_note: 'manual', debt_update: 'system',
  customer_update: 'system', manual: 'system',
}

async function stepTimeline(
  ctx:    Ctx,
  source: EventSource,
  score:  ScoreResult | null,
  extraData?: Record<string, unknown>,
): Promise<boolean> {
  const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
  const summaries: Record<EventSource, string> = {
    csv_import:       `Ù…Ø³ØªÙˆØ±Ø¯: ${ctx.customer.full_name} â€” ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}`,
    excel_import:     `Ù…Ø³ØªÙˆØ±Ø¯ (Excel): ${ctx.customer.full_name} â€” ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}`,
    api_sync:         `Ù…ØªØ²Ø§Ù…Ù† Ù…Ù† Ø§Ù„Ù†Ø¸Ø§Ù… â€” Ù…Ø±Ø¬Ø¹: ${ctx.debt.reference_number}`,
    webhook_whatsapp: `Ø±Ø³Ø§Ù„Ø© ÙˆØ§Ø±Ø¯Ø© Ù…Ù† ${ctx.customer.full_name}`,
    webhook_call:     `Ù†ØªÙŠØ¬Ø© Ù…ÙƒØ§Ù„Ù…Ø©: ${ctx.debt.last_contact_result ?? 'Ù…Ø³Ø¬Ù„Ø©'}`,
    payment_update:   `Ø¯ÙØ¹Ø© Ù…Ø³Ø¬Ù„Ø© â€” Ù…Ø±Ø¬Ø¹: ${ctx.debt.reference_number}`,
    promise_update:   `ÙˆØ¹Ø¯ Ø³Ø¯Ø§Ø¯ Ù…Ø­Ø¯Ù‘Ø«`,
    collector_note:   `Ù…Ù„Ø§Ø­Ø¸Ø© Ù…Ø­ØµÙ‘Ù„: ${(ctx.debt.notes ?? '').slice(0, 60)}`,
    debt_update:      `ØªØ­Ø¯ÙŠØ« Ø¯ÙŠÙ† â€” Ø§Ù„Ø­Ø§Ù„Ø©: ${ctx.debt.status}`,
    customer_update:  `ØªØ­Ø¯ÙŠØ« Ø¨ÙŠØ§Ù†Ø§Øª Ø§Ù„Ø¹Ù…ÙŠÙ„`,
    manual:           `Ù…Ø¹Ø§Ù„Ø¬Ø© ÙŠØ¯ÙˆÙŠØ© â€” Ø§Ù„Ø±ØµÙŠØ¯: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}`,
  }
  try {
    await createServiceClient().from('timeline_events').insert({
      company_id:  ctx.debt.company_id,
      customer_id: ctx.debt.customer_id,
      debt_id:     ctx.debt.id,
      event_type:  'ai_analysis',
      channel:     CHANNEL_MAP[source] ?? 'system',
      summary:     summaries[source] ?? `Ø­Ø¯Ø«: ${source}`,
      detail:      JSON.stringify({
        source,
        status:      ctx.debt.status,
        balance:     ctx.debt.current_balance,
        currency:    ctx.debt.currency,
        days_overdue: daysOverdue,
        reference:   ctx.debt.reference_number,
        ai_score:    score?.score ?? null,
        ai_risk:     score?.risk_classification ?? null,
        ...(extraData ?? {}),
      }).slice(0, 1000),
      actor_type:  'system',
      ai_used:     score !== null,
      metadata:    { source, reference: ctx.debt.reference_number },
      occurred_at: new Date().toISOString(),
    })
    return true
  } catch (err) {
    log.warn(`timeline(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
    return false
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: AI Memory
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepMemory(ctx: Ctx): Promise<number> {
  const sb = createServiceClient()
  let added = 0

  const entries: Array<{ pattern: string; text: string; cat: string }> = []

  // 1. Debt notes / last contact result
  for (const raw of [ctx.debt.notes, ctx.debt.last_contact_result]) {
    if (!raw || raw.trim().length < 8) continue
    const note  = raw.trim()
    const lower = note.toLowerCase()
    const cat =
      lower.includes('Ø¨Ø³Ø¯Ø¯') || lower.includes('will pay') || lower.includes('Ø³ÙˆÙ') ? 'payment_promise' :
      lower.includes('ØºØ§Ø¶Ø¨') || lower.includes('angry') || lower.includes('ÙŠØ´ØªÙƒÙŠ') ? 'angry' :
      lower.includes('Ù…Ùˆ Ø¹Ù†Ø¯ÙŠ') || lower.includes('no money') || lower.includes('Ø¸Ø±ÙˆÙ') ? 'objection' :
      lower.includes('ØªØµØ¹ÙŠØ¯') || lower.includes('legal') || lower.includes('Ù…Ø­ÙƒÙ…Ø©') ? 'escalation' :
      'general'
    entries.push({ pattern: note.slice(0, 200), text: note, cat })
  }

  // 2. Customer + debt profile (always useful for AI context)
  if (ctx.customer.full_name && ctx.debt.current_balance > 0) {
    const profile = `Ø¹Ù…ÙŠÙ„: ${ctx.customer.full_name} | Ø±ØµÙŠØ¯: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency} | Ø­Ø§Ù„Ø©: ${ctx.debt.status} | Ù…Ø±Ø¬Ø¹: ${ctx.debt.reference_number}`
    entries.push({ pattern: profile.slice(0, 200), text: profile, cat: 'general' })
  }

  // 3. Payment behaviour
  if (ctx.payments.length > 0) {
    const txt = `Ø³Ø¬Ù„ Ù…Ø¯ÙÙˆØ¹Ø§Øª: ${ctx.payments.length} Ø¯ÙØ¹Ø© â€” Ø¢Ø®Ø± Ø¯ÙØ¹Ø©: ${ctx.payments[0]?.date ?? 'ØºÙŠØ± Ù…Ø­Ø¯Ø¯'}`
    entries.push({ pattern: txt.slice(0, 200), text: txt, cat: 'payment_promise' })
  }

  for (const e of entries) {
    if (!e.pattern.trim()) continue
    try {
      const { data: ex } = await sb.from('ai_memory')
        .select('id').eq('company_id', ctx.debt.company_id)
        .eq('trigger_pattern', e.pattern).maybeSingle()
      if (ex) continue

      await sb.from('ai_memory').insert({
        company_id:      ctx.debt.company_id,
        trigger_pattern: e.pattern,
        response_text:   e.text,
        category:        e.cat,
        language:        /[\u0600-\u06FF]/.test(e.pattern) ? 'ar' : 'en',
        status:          'approved',
        is_active:       true,
        source:          'imported',
        success_count:   0,
        use_count:       0,
      })
      added++
    } catch { /* non-critical */ }
  }
  return added
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: AI Score (always runs, falls back to rule-based)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepScore(ctx: Ctx): Promise<ScoreResult> {
  const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
  const scoreInput = {
    debt:                ctx.debt as unknown as Parameters<typeof scoreDebt>[0]['debt'],
    customer:            ctx.customer as unknown as Parameters<typeof scoreDebt>[0]['customer'],
    payment_history:     ctx.payments.map(p => ({ amount: p.amount, date: p.date, status: p.status })),
    days_overdue:        daysOverdue,
    total_payments_made: ctx.payments.length,
  }

  let result: ScoreResult
  try {
    result = await scoreDebt(scoreInput)
  } catch {
    result = scoringFallback(scoreInput)
  }

  // Persist (non-blocking on failure)
  const sb = createServiceClient()
  try {
    await sb.from('ai_scores').insert({
      company_id:             ctx.debt.company_id,
      debt_id:                ctx.debt.id,
      customer_id:            ctx.debt.customer_id,
      score:                  result.score,
      risk_classification:    result.risk_classification,
      collection_probability: result.collection_probability / 100,
      recommended_strategy:   result.recommended_strategy,
      factors:                result.factors,
    })
  } catch { /* non-critical */ }

  // Update debt priority
  const newPriority =
    result.score < 25 ? 'critical' : result.score < 50 ? 'high' :
    result.score < 75 ? 'medium' : 'low'
  if (newPriority !== ctx.debt.priority) {
    try {
      await sb.from('debts').update({ priority: newPriority }).eq('id', ctx.debt.id)
    } catch { /* non-critical */ }
  }

  return result
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: AI Action (TEST + LIVE only, one per debt per day)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepAction(ctx: Ctx, score: ScoreResult, today: string): Promise<boolean> {
  const sb = createServiceClient()
  try {
    const { count } = await sb.from('ai_actions')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', ctx.debt.company_id)
      .eq('debt_id', ctx.debt.id)
      .eq('scheduled_for', today)
      .eq('status', 'pending')
    if ((count ?? 0) > 0) return false
  } catch { /* continue */ }

  const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
  const hasWA = !!(ctx.customer.whatsapp)
  const hasPhone = !!(ctx.customer.phone)

  const action_type =
    ctx.debt.status === 'legal'    ? 'legal'    :
    ctx.debt.status === 'disputed' ? 'escalate' :
    daysOverdue > 180              ? 'legal'    :
    daysOverdue > 90               ? 'escalate' :
    score.score < 30               ? 'settle'   :
    hasWA                          ? 'whatsapp' :
    hasPhone                       ? 'call'     : 'email'

  const priority =
    score.score < 25 || daysOverdue > 90 || ctx.debt.current_balance > 50000 ? 'critical' :
    score.score < 50 || daysOverdue > 30 || ctx.debt.current_balance > 20000 ? 'high'     :
    daysOverdue > 0                                                             ? 'medium'   : 'low'

  const reason = [
    daysOverdue > 0 ? `${daysOverdue} ÙŠÙˆÙ… ØªØ£Ø®Ø±` : 'Ù…ØªØ§Ø¨Ø¹Ø© Ø¯ÙˆØ±ÙŠØ©',
    `Ø§Ù„Ø±ØµÙŠØ¯: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}`,
    `Ø§Ù„Ù…Ø®Ø§Ø·Ø±Ø©: ${score.risk_classification}`,
  ].join(' | ').slice(0, 300)

  const msg =
    ctx.debt.status === 'legal'
      ? `Ø¹Ø²ÙŠØ²Ù†Ø§ ${ctx.customer.full_name}ØŒ ÙŠØ±Ø¬Ù‰ Ø§Ù„ØªÙˆØ§ØµÙ„ ÙÙˆØ±Ø§Ù‹ Ù„ØªØ³ÙˆÙŠØ© Ø§Ù„Ø¯ÙŠÙ† Ø±Ù‚Ù… ${ctx.debt.reference_number} ØªÙØ§Ø¯ÙŠØ§Ù‹ Ù„Ù„Ø¥Ø¬Ø±Ø§Ø¡Ø§Øª Ø§Ù„Ù‚Ø§Ù†ÙˆÙ†ÙŠØ©.`
      : daysOverdue > 30
        ? `Ù…Ø±Ø­Ø¨Ø§Ù‹ ${ctx.customer.full_name}ØŒ Ù„Ø¯ÙŠÙƒ Ù…Ø¯ÙŠÙˆÙ†ÙŠØ© Ø¨Ù‚ÙŠÙ…Ø© ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}. ÙŠØ³Ø¹Ø¯Ù†Ø§ Ù…Ø³Ø§Ø¹Ø¯ØªÙƒ ÙÙŠ ØªØ±ØªÙŠØ¨ Ø®Ø·Ø© Ø³Ø¯Ø§Ø¯.`
        : `Ù…Ø±Ø­Ø¨Ø§Ù‹ ${ctx.customer.full_name}ØŒ ØªÙˆØ§ØµÙ„Ù†Ø§ Ø¨Ø®ØµÙˆØµ Ø§Ù„Ø¯ÙŠÙ† Ø±Ù‚Ù… ${ctx.debt.reference_number}. ÙŠØ±Ø¬Ù‰ Ø§Ù„ØªÙˆØ§ØµÙ„ Ù„Ù…Ù†Ø§Ù‚Ø´Ø© Ø®ÙŠØ§Ø±Ø§Øª Ø§Ù„Ø³Ø¯Ø§Ø¯.`

  try {
    await createServiceClient().from('ai_actions').insert({
      company_id:           ctx.debt.company_id,
      debt_id:              ctx.debt.id,
      customer_id:          ctx.debt.customer_id,
      assigned_to:          null,
      action_type,
      priority,
      priority_score:       score.score,
      reason,
      suggested_message:    msg.slice(0, 800),
      best_time_to_contact: '10:00 - 12:00, 16:00 - 19:00',
      scheduled_for:        today,
      scheduled_date:       today,
      status:               'pending',
    })
    return true
  } catch (err) {
    log.warn(`stepAction insert(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
    return false
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: Rules engine (all matching rules)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepRules(ctx: Ctx, score: ScoreResult): Promise<string[]> {
  const matched: string[] = []
  try {
    const sb = createServiceClient()
    const { data: rules } = await sb.from('collection_rules')
      .select('id,name,condition,action,trigger_count')
      .eq('company_id', ctx.debt.company_id)
      .eq('is_active', true)
      .order('priority')
      .limit(30)
    if (!rules?.length) return matched

    const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
    const fieldMap: Record<string, unknown> = {
      'debt.status':          ctx.debt.status,
      'debt.current_balance': ctx.debt.current_balance,
      'debt.priority':        ctx.debt.priority,
      'last_contact_result':  ctx.debt.last_contact_result ?? '',
      'days_overdue':         daysOverdue,
      'ai_score':             score.score,
      'ai_risk':              score.risk_classification,
    }

    for (const rule of rules as Array<Record<string, unknown>>) {
      const cond = rule.condition as Record<string, unknown>
      const fv   = fieldMap[String(cond.field ?? '')]
      const op   = String(cond.operator ?? 'eq')
      const val  = cond.value
      let hit = false
      if (op === 'eq')           hit = String(fv) === String(val)
      if (op === 'neq')          hit = String(fv) !== String(val)
      if (op === 'gt')           hit = Number(fv) > Number(val)
      if (op === 'gte')          hit = Number(fv) >= Number(val)
      if (op === 'lt')           hit = Number(fv) < Number(val)
      if (op === 'lte')          hit = Number(fv) <= Number(val)
      if (op === 'contains')     hit = String(fv ?? '').toLowerCase().includes(String(val ?? '').toLowerCase())
      if (op === 'contains_any') hit = Array.isArray(val) && val.some(v => String(fv ?? '').toLowerCase().includes(String(v).toLowerCase()))

      if (hit) {
        matched.push(String(rule.action))
        try {
          await sb.from('collection_rules').update({
            trigger_count: Number(rule.trigger_count ?? 0) + 1,
            last_triggered_at: new Date().toISOString(),
          }).eq('id', rule.id)
          // Timeline entry for rule trigger
          await sb.from('timeline_events').insert({
            company_id:  ctx.debt.company_id,
            customer_id: ctx.debt.customer_id,
            debt_id:     ctx.debt.id,
            event_type:  'rule_triggered',
            channel:     'system',
            summary:     `Ù‚Ø§Ø¹Ø¯Ø©: ${String(rule.name)} â† ${String(rule.action)}`,
            actor_type:  'system',
            occurred_at: new Date().toISOString(),
          })
        } catch { /* non-critical */ }
      }
    }
  } catch (err) {
    log.warn(`stepRules(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
  }
  return matched
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: Alerts
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepAlerts(ctx: Ctx, score: ScoreResult): Promise<number> {
  const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
  type AlertRow = { title: string; severity: string; alert_type: string; message: string }
  const rows: AlertRow[] = []

  if (ctx.debt.status === 'legal')
    rows.push({ title: `Ù‚Ø¶ÙŠØ© Ù‚Ø§Ù†ÙˆÙ†ÙŠØ©: ${ctx.customer.full_name}`, severity: 'critical', alert_type: 'legal_case',
      message: `${ctx.debt.reference_number} â€” ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })

  if (ctx.debt.status === 'disputed')
    rows.push({ title: `Ù…ØªÙ†Ø§Ø²Ø¹ Ø¹Ù„ÙŠÙ‡: ${ctx.customer.full_name}`, severity: 'error', alert_type: 'disputed',
      message: `${ctx.debt.reference_number} â€” ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })

  if (daysOverdue > 180)
    rows.push({ title: `ØªØ£Ø®Ø± Ø´Ø¯ÙŠØ¯ ${daysOverdue}ÙŠ: ${ctx.customer.full_name}`, severity: 'critical', alert_type: 'overdue_180',
      message: `Ø§Ù„Ø±ØµÙŠØ¯: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency} â€” ${daysOverdue} ÙŠÙˆÙ… ØªØ£Ø®Ø±` })
  else if (daysOverdue > 90)
    rows.push({ title: `ØªØ£Ø®Ø± Ø¹Ø§Ù„Ù ${daysOverdue}ÙŠ: ${ctx.customer.full_name}`, severity: 'error', alert_type: 'overdue_90',
      message: `Ø§Ù„Ø±ØµÙŠØ¯: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })
  else if (daysOverdue > 30)
    rows.push({ title: `ØªØ£Ø®Ø± Ù…ØªÙˆØ³Ø· ${daysOverdue}ÙŠ: ${ctx.customer.full_name}`, severity: 'warning', alert_type: 'overdue_30',
      message: `Ø§Ù„Ø±ØµÙŠØ¯: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })

  if (ctx.debt.current_balance >= 8000 && daysOverdue > 0)
    rows.push({ title: `Ø±ØµÙŠØ¯ Ù…Ø±ØªÙØ¹: ${ctx.customer.full_name}`, severity: 'warning', alert_type: 'high_balance',
      message: `${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency} â€” ${daysOverdue} ÙŠÙˆÙ… ØªØ£Ø®Ø±` })

  if (score.risk_classification === 'critical')
    rows.push({ title: `Ø®Ø·Ø± Ø´Ø¯ÙŠØ¯ (AI ${score.score}): ${ctx.customer.full_name}`, severity: 'critical', alert_type: 'ai_critical',
      message: score.recommended_strategy?.slice(0, 100) ?? '' })
  else if (score.risk_classification === 'high' && ctx.debt.current_balance > 5000)
    rows.push({ title: `Ø®Ø·Ø± Ø¹Ø§Ù„Ù (AI ${score.score}): ${ctx.customer.full_name}`, severity: 'error', alert_type: 'ai_high',
      message: `Ø§Ù„Ø±ØµÙŠØ¯: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })

  if (!rows.length) return 0

  try {
    const sb = createServiceClient()
    // Dedup: skip alert_types already fired in last 24h for this debt
    const since = new Date(Date.now() - 86400000).toISOString()
    const { data: recent } = await sb.from('system_alerts')
      .select('alert_type')
      .eq('company_id', ctx.debt.company_id)
      .gte('created_at', since)

    const seen = new Set((recent ?? []).map((r: {alert_type?: string}) => r.alert_type ?? ''))
    const fresh = rows.filter(r => !seen.has(r.alert_type) || r.severity === 'critical')
    if (!fresh.length) return 0

    await sb.from('system_alerts').insert(fresh.map(r => ({
      company_id:  ctx.debt.company_id,
      severity:    r.severity,
      alert_type:  r.alert_type,
      title:       r.title,
      message:     r.message,
      metadata:    { debt_id: ctx.debt.id, customer_id: ctx.debt.customer_id,
                     balance: ctx.debt.current_balance, currency: ctx.debt.currency,
                     days_overdue: daysOverdue, ai_score: score.score },
      is_read:     false,
      is_resolved: false,
    })))
    return fresh.length
  } catch (err) {
    log.warn(`stepAlerts(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
    return 0
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: Promises
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepPromises(ctx: Ctx): Promise<void> {
  const today   = new Date().toISOString().split('T')[0]
  const in2days = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]
  const sb = createServiceClient()
  try {
    // Mark overdue promises as broken
    await sb.from('promises')
      .update({ status: 'broken' })
      .eq('company_id', ctx.debt.company_id)
      .eq('debt_id', ctx.debt.id)
      .eq('status', 'pending')
      .lt('promised_date', today)

    // Flag upcoming promises in timeline
    const { data: upcoming } = await sb.from('promises')
      .select('promised_date,promised_amount')
      .eq('company_id', ctx.debt.company_id)
      .eq('debt_id', ctx.debt.id)
      .eq('status', 'pending')
      .gte('promised_date', today)
      .lte('promised_date', in2days)
      .maybeSingle()

    if (upcoming) {
      const u = upcoming as Record<string, unknown>
      await sb.from('timeline_events').insert({
        company_id:  ctx.debt.company_id,
        customer_id: ctx.debt.customer_id,
        debt_id:     ctx.debt.id,
        event_type:  'promise_to_pay',
        channel:     'system',
        summary:     `ÙˆØ¹Ø¯ Ø³Ø¯Ø§Ø¯ Ù‚Ø§Ø¯Ù…: ${u.promised_amount} ${ctx.debt.currency} ÙÙŠ ${u.promised_date}`,
        actor_type:  'system',
        occurred_at: new Date().toISOString(),
      })
    }
  } catch (err) {
    log.warn(`stepPromises(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: Approvals
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepApprovals(ctx: Ctx): Promise<void> {
  const needsApproval =
    (ctx.debt.status === 'legal' && ctx.debt.current_balance > 10000) ||
    ctx.debt.current_balance > 50000 ||
    ctx.debt.status === 'disputed'
  if (!needsApproval) return
  try {
    const sb = createServiceClient()
    const { data: ex } = await sb.from('approvals')
      .select('id').eq('company_id', ctx.debt.company_id)
      .eq('entity_id', ctx.debt.id).in('status', ['pending']).maybeSingle()
    if (ex) return

    const approval_type =
      ctx.debt.status === 'legal'      ? 'legal_escalation' :
      ctx.debt.current_balance > 50000 ? 'large_settlement' : 'stop_followup'

    await sb.from('approvals').insert({
      company_id:    ctx.debt.company_id,
      approval_type,
      title:         `${approval_type === 'legal_escalation' ? 'ØªØµØ¹ÙŠØ¯ Ù‚Ø§Ù†ÙˆÙ†ÙŠ' : approval_type === 'large_settlement' ? 'ØªØ³ÙˆÙŠØ© ÙƒØ¨ÙŠØ±Ø©' : 'Ù…Ø±Ø§Ø¬Ø¹Ø©'}: ${ctx.customer.full_name}`,
      description:   `${ctx.debt.reference_number} â€” ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency} â€” ${ctx.debt.status}`,
      entity_type:   'debt',
      entity_id:     ctx.debt.id,
      requested_data: { debt_id: ctx.debt.id, customer: ctx.customer.full_name,
                        balance: ctx.debt.current_balance, currency: ctx.debt.currency,
                        status: ctx.debt.status, reference: ctx.debt.reference_number },
      status:        'pending',
      priority:      ctx.debt.status === 'legal' || ctx.debt.current_balance > 50000 ? 'urgent' : 'high',
      expires_at:    new Date(Date.now() + 48 * 3600000).toISOString(),
    })
  } catch (err) {
    log.warn(`stepApprovals(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: Campaign eligibility
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepCampaigns(ctx: Ctx): Promise<void> {
  try {
    const sb = createServiceClient()
    const { data: camps } = await sb.from('campaigns')
      .select('id,campaign_type,target_filter,target_count,status')
      .eq('company_id', ctx.debt.company_id)
      .in('status', ['draft', 'scheduled'])
      .limit(10)
    if (!camps?.length) return

    const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
    for (const camp of camps as Array<Record<string, unknown>>) {
      const type   = String(camp.campaign_type ?? '')
      const filter = (camp.target_filter ?? {}) as Record<string, unknown>
      let eligible =
        (type === 'overdue_90'   && daysOverdue >= 90) ||
        (type === 'pre_salary'   && daysOverdue > 0) ||
        (type === 'post_holiday' && daysOverdue > 0) ||
        (type === 'settlement'   && ctx.debt.current_balance > 5000 && daysOverdue > 60) ||
        (type === 'reminder'     && daysOverdue > 0 && daysOverdue < 30)

      if (filter.min_balance && ctx.debt.current_balance < Number(filter.min_balance)) eligible = false
      if (filter.max_balance && ctx.debt.current_balance > Number(filter.max_balance)) eligible = false
      if (eligible) {
        await sb.from('campaigns')
          .update({ target_count: Number(camp.target_count ?? 0) + 1 })
          .eq('id', camp.id)
      }
    }
  } catch (err) {
    log.warn(`stepCampaigns(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Step: WhatsApp queue (LIVE only)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stepWhatsApp(ctx: Ctx): Promise<boolean> {
  const phone = ctx.customer.whatsapp ?? ctx.customer.phone
  if (!phone) return false
  const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
  if (daysOverdue <= 0) return false

  const msg = `Ù…Ø±Ø­Ø¨Ø§Ù‹ ${ctx.customer.full_name}ØŒ ØªØ°ÙƒÙŠØ± Ø¨Ù…Ø¯ÙŠÙˆÙ†ÙŠØ© ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency} â€” Ù…Ø±Ø¬Ø¹: ${ctx.debt.reference_number}. ÙŠØ±Ø¬Ù‰ Ø§Ù„ØªÙˆØ§ØµÙ„ Ù„ØªØ±ØªÙŠØ¨ Ø§Ù„Ø³Ø¯Ø§Ø¯.`
  try {
    await createServiceClient().from('job_queue').insert({
      company_id:   ctx.debt.company_id,
      job_type:     'send_whatsapp',
      payload:      { phone, message: msg, company_id: ctx.debt.company_id,
                      customer_id: ctx.debt.customer_id, debt_id: ctx.debt.id },
      priority:     3,
      status:       'pending',
      scheduled_at: new Date(Date.now() + 60_000).toISOString(),
      max_attempts: 3,
      attempts:     0,
    })
    return true
  } catch (err) {
    log.warn(`stepWhatsApp(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
    return false
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Main: processEvent
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function processEvent(event: PipelineEvent): Promise<PipelineResult> {
  const R: PipelineResult = {
    success: false, mode: 'off',
    ai_actions_count: 0, alerts_count: 0, memory_count: 0,
    steps_completed: [], steps_skipped: [], steps_failed: [],
  }

  const debtId     = event._debt_id     ?? event.debt_id
  const companyId  = event.company_id

  if (!debtId) { R.error = 'No debt_id'; return R }

  try {
    // Config
    const cfg = await getConfig(companyId)
    R.mode = cfg.mode
    if (cfg.emergency) {
      R.steps_skipped.push('all:emergency_stop')
      R.success = true
      return R
    }

    // Load context
    const ctx = await loadCtx(debtId, companyId)
    if (!ctx) { R.error = `Debt ${debtId} not found`; return R }
    R.debt_id     = ctx.debt.id
    R.customer_id = ctx.debt.customer_id
    R.steps_completed.push('load_context')

    // Terminal check
    if (isTerminal(ctx.debt.status, ctx.debt.current_balance)) {
      R.steps_skipped.push(`terminal:${ctx.debt.status}`)
      R.success = true
      return R
    }

    const today = new Date().toISOString().split('T')[0]

    // â”€â”€ AI Memory (always) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      R.memory_count = await stepMemory(ctx)
      R.steps_completed.push(`memory:${R.memory_count}`)
    } catch { R.steps_failed.push('memory') }

    // â”€â”€ AI Score (always â€” OFF/TEST/LIVE) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    let score: ScoreResult
    try {
      score = await stepScore(ctx)
      R.ai_score = score.score
      R.ai_risk  = score.risk_classification
      R.steps_completed.push(`score:${score.score}:${score.risk_classification}`)
    } catch (err) {
      score = scoringFallback({
        debt:                ctx.debt as unknown as Parameters<typeof scoringFallback>[0]['debt'],
        customer:            ctx.customer as unknown as Parameters<typeof scoringFallback>[0]['customer'],
        payment_history:     ctx.payments.map(p => ({ amount: p.amount, date: p.date, status: p.status })),
        days_overdue:        ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0,
        total_payments_made: ctx.payments.length,
      })
      R.ai_score = score.score
      R.ai_risk  = score.risk_classification
      R.steps_failed.push('score:used_fallback')
    }

    // â”€â”€ Timeline (always) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const ok = await stepTimeline(ctx, event.source, score, event.data)
      ok ? R.steps_completed.push('timeline') : R.steps_failed.push('timeline')
    } catch { R.steps_failed.push('timeline') }

    // â”€â”€ AI Action (TEST + LIVE only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (cfg.mode !== 'off') {
      try {
        const created = await stepAction(ctx, score, today)
        if (created) { R.ai_actions_count++; R.steps_completed.push('action:created') }
        else R.steps_skipped.push('action:duplicate')
      } catch { R.steps_failed.push('action') }
    } else {
      R.steps_skipped.push('action:mode_off')
    }

    // â”€â”€ Rules (always) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      const matches = await stepRules(ctx, score)
      R.steps_completed.push(`rules:${matches.length ? matches.join(',') : 'none'}`)
    } catch { R.steps_failed.push('rules') }

    // â”€â”€ Alerts (always) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      R.alerts_count = await stepAlerts(ctx, score)
      R.steps_completed.push(`alerts:${R.alerts_count}`)
    } catch { R.steps_failed.push('alerts') }

    // â”€â”€ Promises (always) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      await stepPromises(ctx)
      R.steps_completed.push('promises')
    } catch { R.steps_failed.push('promises') }

    // â”€â”€ Approvals (always) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      await stepApprovals(ctx)
      R.steps_completed.push('approvals')
    } catch { R.steps_failed.push('approvals') }

    // â”€â”€ Campaigns (always) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    try {
      await stepCampaigns(ctx)
      R.steps_completed.push('campaigns')
    } catch { R.steps_failed.push('campaigns') }

    // â”€â”€ WhatsApp (LIVE only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (cfg.mode === 'live' && !cfg.emergency_wa) {
      try {
        const queued = await stepWhatsApp(ctx)
        R.steps_completed.push(queued ? 'whatsapp:queued' : 'whatsapp:skipped')
      } catch { R.steps_failed.push('whatsapp') }
    } else {
      R.steps_skipped.push(`whatsapp:mode_${cfg.mode}`)
    }

    log.info('pipeline done', {
      debt_id:  ctx.debt.id, mode: cfg.mode,
      score:    R.ai_score, risk: R.ai_risk,
      alerts:   R.alerts_count, actions: R.ai_actions_count,
      ok:       R.steps_completed.length, fail: R.steps_failed.length,
    })

    R.success = true
  } catch (err) {
    R.error   = err instanceof Error ? err.message : String(err)
    R.success = false
    log.warn('pipeline crash: ' + R.error)
  }
  return R
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Batch processor
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function processEventBatch(
  events:      PipelineEvent[],
  concurrency = 4,
): Promise<{ total: number; succeeded: number; failed: number; skipped: number; total_alerts: number; total_actions: number }> {
  const R = { total: events.length, succeeded: 0, failed: 0, skipped: 0, total_alerts: 0, total_actions: 0 }
  if (!events.length) return R

  for (let i = 0; i < events.length; i += concurrency) {
    const settled = await Promise.allSettled(
      events.slice(i, i + concurrency).map(e => processEvent(e))
    )
    for (const r of settled) {
      if (r.status === 'fulfilled') {
        const v = r.value
        R.total_alerts  += v.alerts_count
        R.total_actions += v.ai_actions_count
        if (v.success) {
          v.steps_skipped.some(s => s.startsWith('terminal')) ? R.skipped++ : R.succeeded++
        } else {
          R.failed++
        }
      } else {
        R.failed++
      }
    }
  }
  log.info('batch done', R)
  return R
}

