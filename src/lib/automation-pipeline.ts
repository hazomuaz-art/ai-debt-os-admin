/**
 * Automation Pipeline — Production Orchestrator
 *
 * Single source of truth for all module orchestration.
 * Called synchronously from import, sync, webhook, and manual triggers.
 *
 * Mode contract:
 *   ALL modes  → load context, timeline, ai_memory, ai_score, rules, alerts, promises, approvals, campaigns
 *   test+live  → also create ai_actions (status='pending')
 *   live only  → also queue WhatsApp messages
 *   emergency_stop → skip everything, return immediately
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
import { detectCustomerIntent } from '@/lib/negotiation-intent'
import { insertTimelineEvent } from '@/lib/timeline'
import { insertApproval } from '@/lib/approvals'
import { insertSystemAlert } from '@/lib/system-alerts'
import { recordDispute } from '@/lib/dispute'
import { recordPaymentClaim } from '@/lib/payment-claim'

const log = createLogger('automation-pipeline')

// Shared by stepAction and stepWhatsApp — a debt already being actively
// negotiated/promised/on a plan shouldn't get a fresh automated action or
// WhatsApp send layered on top. Single source so both stay in sync.
const ACTIVE_NEGOTIATION_STATUSES = ['promised', 'in_negotiation', 'payment_plan']

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type EventSource =
  | 'csv_import' | 'excel_import' | 'api_sync'
  | 'webhook_whatsapp' | 'webhook_evolution' | 'webhook_call'
  | 'payment_update' | 'promise_update' | 'refusal_detected' | 'dispute_detected' | 'payment_claim_detected' | 'legal_escalation_detected' | 'collector_note'
  | 'debt_update' | 'customer_update' | 'manual' | 'ai_reply'

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

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Terminal status check
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL = new Set([
  'settled', 'paid', 'closed', 'written_off', 'cancelled',
  'مسدد', 'مغلق', 'منتهي',
])

function isTerminal(status: string, balance: number): boolean {
  if (balance <= 0) return true
  const s = status.toLowerCase().trim()
  return TERMINAL.has(s) || s.includes('settled') || s.includes('paid') ||
         s.includes('closed') || s.includes('written')
}

// ─────────────────────────────────────────────────────────────────────────────
// Config loader (60-second cache)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Context loader
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Step: Timeline event
// ─────────────────────────────────────────────────────────────────────────────

// 'refusal'/'dispute'/'payment_claim'/'legal_escalation' were never valid
// timeline_events.event_type values (only a fixed list is allowed — see
// timeline_events_event_type_check) — every timeline insert for these 4
// event sources has been silently failing since this map was written,
// undetectable because the catch block below can never catch a Postgres
// constraint violation (Supabase JS returns {error}, it doesn't throw).
const EVENT_TYPE_MAP: Record<EventSource, string> = {
  csv_import: 'status_change', excel_import: 'status_change', api_sync: 'status_change',
  webhook_whatsapp: 'whatsapp_in', webhook_evolution: 'whatsapp_in', webhook_call: 'call_in',
  payment_update: 'payment', promise_update: 'promise_to_pay',
  refusal_detected: 'status_change', dispute_detected: 'status_change', payment_claim_detected: 'payment', legal_escalation_detected: 'escalation',
  collector_note: 'collector_note', debt_update: 'status_change',
  customer_update: 'status_change', manual: 'ai_analysis', ai_reply: 'ai_analysis',
}

const CHANNEL_MAP: Record<EventSource, string> = {
  csv_import: 'system', excel_import: 'system', api_sync: 'system',
  webhook_whatsapp: 'whatsapp', webhook_evolution: 'whatsapp', webhook_call: 'call',
  payment_update: 'system', promise_update: 'whatsapp',
  refusal_detected: 'whatsapp', dispute_detected: 'whatsapp', payment_claim_detected: 'whatsapp', legal_escalation_detected: 'whatsapp',
  collector_note: 'manual', debt_update: 'system',
  customer_update: 'system', manual: 'system', ai_reply: 'whatsapp',
}

async function stepTimeline(
  ctx:    Ctx,
  source: EventSource,
  score:  ScoreResult | null,
  extraData?: Record<string, unknown>,
): Promise<boolean> {
  const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
  const summaries: Record<EventSource, string> = {
    csv_import:       `مستورد: ${ctx.customer.full_name} — ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}`,
    excel_import:     `مستورد (Excel): ${ctx.customer.full_name} — ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}`,
    api_sync:         `متزامن من النظام — مرجع: ${ctx.debt.reference_number}`,
    webhook_whatsapp: `رسالة واردة من ${ctx.customer.full_name}`,
    webhook_evolution: `رسالة واتساب واردة من ${ctx.customer.full_name}`,
    webhook_call:     `نتيجة مكالمة: ${ctx.debt.last_contact_result ?? 'مسجلة'}`,
    payment_update:   `دفعة مسجلة — مرجع: ${ctx.debt.reference_number}`,
    promise_update:   `وعد سداد محدّث`,
    refusal_detected: `رفض سداد من العميل`,
    dispute_detected: `اعتراض من العميل`,
    payment_claim_detected: `العميل أفاد بالسداد أو التحويل`,
    legal_escalation_detected: `طلب أو تهديد بتصعيد قانوني`,
    collector_note:   `ملاحظة محصّل: ${(ctx.debt.notes ?? '').slice(0, 60)}`,
    debt_update:      `تحديث دين — الحالة: ${ctx.debt.status}`,
    customer_update:  `تحديث بيانات العميل`,
    manual:           `معالجة يدوية — الرصيد: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}`,
    ai_reply:         `رد آلي من الوكيل على ${ctx.customer.full_name}`,
  }
  try {
    // Supabase JS never throws on a constraint violation — it returns
    // {error}. This catch block alone could never have caught the
    // EVENT_TYPE_MAP bug above; checking {error} explicitly now so a
    // future invalid value here is caught immediately instead of silently
    // vanishing again.
    const { error: teErr } = await createServiceClient().from('timeline_events').insert({
      company_id:  ctx.debt.company_id,
      customer_id: ctx.debt.customer_id,
      debt_id:     ctx.debt.id,
      event_type:  EVENT_TYPE_MAP[source] ?? 'ai_analysis',
      channel:     CHANNEL_MAP[source] ?? 'system',
      summary:     summaries[source] ?? `حدث: ${source}`,
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
    if (teErr) { log.warn(`timeline(${ctx.debt.id}): ` + teErr.message); return false }
    return true
  } catch (err) {
    log.warn(`timeline(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step: AI Memory
// ─────────────────────────────────────────────────────────────────────────────

// ai_memory is disabled — confirmed unused in the actual agent reply path.
// Read/write disabled at the source rather than dropping the table, so it
// remains a safe rollback if ever needed.
async function stepMemory(_ctx: Ctx): Promise<number> {
  return 0
}


// ─────────────────────────────────────────────────────────────────────────────
// Step: AI Score (always runs, falls back to rule-based)
// ─────────────────────────────────────────────────────────────────────────────

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

  // Persist (non-blocking on failure — but must still be LOGGED, otherwise a
  // failed insert here looks identical to a successful score in every log
  // line above it, e.g. "Debt scored via AI", making the silent DB failure
  // invisible).
  const sb = createServiceClient()
  try {
    const { error: scoreInsertErr } = await sb.from('ai_scores').insert({
      company_id:             ctx.debt.company_id,
      debt_id:                ctx.debt.id,
      customer_id:            ctx.debt.customer_id,
      score:                  result.score,
      risk_classification:    result.risk_classification,
      collection_probability: result.collection_probability / 100,
      recommended_strategy:   result.recommended_strategy,
      factors:                result.factors,
    })
    if (scoreInsertErr) log.warn(`stepScore(${ctx.debt.id}) ai_scores insert failed: ${scoreInsertErr.message}`)
  } catch (err) {
    log.warn(`stepScore(${ctx.debt.id}) ai_scores insert threw: ` + (err instanceof Error ? err.message : String(err)))
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// Step: AI Action (TEST + LIVE only, one per debt per day)
// ─────────────────────────────────────────────────────────────────────────────

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

  if (ACTIVE_NEGOTIATION_STATUSES.includes(ctx.debt.status)) return false

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
    daysOverdue > 0 ? `${daysOverdue} يوم تأخر` : 'متابعة دورية',
    `الرصيد: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}`,
    `المخاطرة: ${score.risk_classification}`,
  ].join(' | ').slice(0, 300)

  // Detect language from customer name for natural dialect selection
  const nameIsArabic = /[\u0600-\u06FF]/.test(ctx.customer.full_name ?? '')
  const name = ctx.customer.full_name ?? (nameIsArabic ? 'أستاذ' : 'Customer')
  const bal  = ctx.debt.current_balance.toLocaleString('en-SA')
  const cur  = ctx.debt.currency

  const msg = nameIsArabic
    ? ctx.debt.status === 'legal'
      ? `${name}، المبلغ ${bal} ${cur} وصل للمرحلة القانونية. تواصل معنا على طول لنرتب وضعك قبل ما الأمور تتعقد. رقم المرجع: ${ctx.debt.reference_number}`
      : daysOverdue > 90
        ? `هلا ${name}، المبلغ ${bal} ${cur} متأخر ${daysOverdue} يوم. نحتاج نحل الموضوع. لو في ظروف، نقدر نرتب دفعات. كلمنا.`
        : daysOverdue > 30
          ? `هلا ${name}، عندك مبلغ ${bal} ${cur} متأخر. نقدر نرتب معك دفعات تناسبك. علمني وش الأنسب.`
          : `هلا ${name}، تذكير بمبلغ ${bal} ${cur}. إذا يناسبك تسدد، أو نرتب طريقة ثانية، قولي.`
    : ctx.debt.status === 'legal'
      ? `Hi ${name}, ref ${ctx.debt.reference_number} has progressed to legal status. Please contact us today to discuss resolution options for your ${cur} ${bal} balance.`
      : daysOverdue > 30
        ? `Hi ${name}, your ${cur} ${bal} balance is ${daysOverdue} days overdue. We can arrange a payment plan — just reach out and we will work something out.`
        : `Hi ${name}, quick reminder about your ${cur} ${bal} balance. Happy to arrange a payment option that works for you.`

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

// ─────────────────────────────────────────────────────────────────────────────
// Step: Rules engine (all matching rules)
// ─────────────────────────────────────────────────────────────────────────────

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
            summary:     `قاعدة: ${String(rule.name)} ← ${String(rule.action)}`,
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

// ─────────────────────────────────────────────────────────────────────────────
// Step: Alerts
// ─────────────────────────────────────────────────────────────────────────────

async function stepAlerts(ctx: Ctx, score: ScoreResult): Promise<number> {
  const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
  type AlertRow = { title: string; severity: string; alert_type: string; message: string }
  const rows: AlertRow[] = []

  if (ctx.debt.status === 'legal')
    rows.push({ title: `[قانوني] ${ctx.customer.full_name} - ${ctx.debt.reference_number}`, severity: 'critical', alert_type: 'legal_case',
      message: `${ctx.debt.reference_number} — ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })

  if (ctx.debt.status === 'disputed')
    rows.push({ title: `[متنازع] ${ctx.customer.full_name} - ${ctx.debt.reference_number}`, severity: 'error', alert_type: 'disputed',
      message: `${ctx.debt.reference_number} — ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })

  if (daysOverdue > 180)
    rows.push({ title: `تأخر شديد ${daysOverdue}ي: ${ctx.customer.full_name}`, severity: 'critical', alert_type: 'overdue_180',
      message: `الرصيد: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency} — ${daysOverdue} يوم تأخر` })
  else if (daysOverdue > 90)
    rows.push({ title: `تأخر عالٍ ${daysOverdue}ي: ${ctx.customer.full_name}`, severity: 'error', alert_type: 'overdue_90',
      message: `الرصيد: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })
  else if (daysOverdue > 30)
    rows.push({ title: `تأخر متوسط ${daysOverdue}ي: ${ctx.customer.full_name}`, severity: 'warning', alert_type: 'overdue_30',
      message: `الرصيد: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })

  if (ctx.debt.current_balance >= 8000 && daysOverdue > 0)
    rows.push({ title: `رصيد مرتفع: ${ctx.customer.full_name}`, severity: 'warning', alert_type: 'high_balance',
      message: `${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency} — ${daysOverdue} يوم تأخر` })

  if (score.risk_classification === 'critical')
    rows.push({ title: `خطر شديد (AI ${score.score}): ${ctx.customer.full_name}`, severity: 'critical', alert_type: 'ai_critical',
      message: score.recommended_strategy?.slice(0, 100) ?? '' })
  else if (score.risk_classification === 'high' && ctx.debt.current_balance > 5000)
    rows.push({ title: `خطر عالٍ (AI ${score.score}): ${ctx.customer.full_name}`, severity: 'error', alert_type: 'ai_high',
      message: `الرصيد: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}` })

  if (!rows.length) return 0

  try {
    const sb = createServiceClient()
    // Dedup: skip same alert_type already fired in last 24h for this same debt
    const since = new Date(Date.now() - 86400000).toISOString()
    const { data: recent } = await sb.from('system_alerts')
      .select('alert_type, metadata')
      .eq('company_id', ctx.debt.company_id)
      .gte('created_at', since)

    const seen = new Set(
      (recent ?? [])
        .filter((r: { alert_type?: string; metadata?: Record<string, unknown> }) =>
          String(r.metadata?.debt_id ?? '') === String(ctx.debt.id)
        )
        .map((r: { alert_type?: string }) => r.alert_type ?? '')
    )
    const fresh = rows.filter(r => !seen.has(r.alert_type))
    if (!fresh.length) return 0

    const { error: alertInsertErr } = await sb.from('system_alerts').insert(fresh.map(r => ({
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
    if (alertInsertErr) log.warn(`stepAlerts(${ctx.debt.id}) system_alerts insert failed: ${alertInsertErr.message}`)
    return fresh.length
  } catch (err) {
    log.warn(`stepAlerts(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
    return 0
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step: Promises
// ─────────────────────────────────────────────────────────────────────────────

async function stepPromises(ctx: Ctx, event?: PipelineEvent): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const in2days = new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]

  const sb = createServiceClient()

  try {
    // NOTE: this step deliberately does NOT create promise records from
    // loose keyword-matching on inbound text anymore. That logic used to
    // fire on any message containing e.g. "سداد" + "يوم" — including
    // questions like "متى تاريخ السداد؟" — and fabricated a promised_date
    // (today+2, or tomorrow if "بكرة" was mentioned) that the customer
    // never actually gave. The agent then confronted customers with
    // promises they never made. The only trustworthy source for a real
    // promise is the collector agent's own explicit decision
    // (action === 'record_promise' with a date it extracted from the
    // customer's actual words) — see ai-collector-agent.ts and the
    // webhook handlers that persist it from there.

    const { error: brokenErr } = await sb.from('promises')
      .update({ status: 'broken' })
      .eq('company_id', ctx.debt.company_id)
      .eq('debt_id', ctx.debt.id)
      .eq('status', 'pending')
      .lt('promised_date', today)
    if (brokenErr) log.warn(`stepPromises(${ctx.debt.id}) mark-broken update failed: ${brokenErr.message}`)

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
      await insertTimelineEvent({
        company_id: ctx.debt.company_id,
        customer_id: ctx.debt.customer_id,
        debt_id: ctx.debt.id,
        event_type: 'promise_to_pay',
        channel: String(event?.source ?? '').includes('webhook') ? 'whatsapp' : 'system',
        summary: `وعد سداد قادم: ${u.promised_amount} ${ctx.debt.currency} في ${u.promised_date}`,
        actor_type: 'system',
      })
    }
  } catch (err) {
    log.warn(`stepPromises(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step: Approvals
// ─────────────────────────────────────────────────────────────────────────────
// How long a decided (or still-pending) large-balance/legal review approval
// suppresses a fresh duplicate for the same debt. Real duplication bug this
// fixes: the old dedup only checked for a currently-PENDING approval, so
// once an admin approved or rejected one, the very next pipeline run (every
// AI reply) recreated an identical one — nothing about the debt had changed,
// only the fact that it had already been reviewed.
const APPROVAL_REVIEW_COOLDOWN_DAYS = 7

async function stepApprovals(ctx: Ctx): Promise<void> {
  // Real duplication this fixes: 'disputed' status used to also trigger this
  // generic review, alongside src/lib/dispute.ts's recordDispute() — which
  // already handles disputes with full customer context and real
  // PATCH-time effects. Two independent triggers reacting to the same
  // 'disputed' status produced two different-looking approvals per dispute.
  // Only genuinely separate signals (large balance, legal status) remain here.
  const needsApproval =
    (ctx.debt.status === 'legal' && ctx.debt.current_balance > 10000) ||
    ctx.debt.current_balance > 50000
  if (!needsApproval) return
  try {
    const sb = createServiceClient()
    const cooldownCutoff = new Date(Date.now() - APPROVAL_REVIEW_COOLDOWN_DAYS * 86400000).toISOString()
    const { data: ex } = await sb.from('approvals')
      .select('id').eq('company_id', ctx.debt.company_id)
      .eq('entity_id', ctx.debt.id)
      .in('approval_type', ['legal_escalation', 'large_settlement'])
      .gte('created_at', cooldownCutoff)
      .limit(1).maybeSingle()
    if (ex) return

    const approval_type = ctx.debt.status === 'legal' ? 'legal_escalation' : 'large_settlement'
    const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : null

    const reasonLine =
      approval_type === 'legal_escalation'
        ? `الدين بحالة "قانونية" ورصيده يتجاوز 10,000 ${ctx.debt.currency} — يحتاج موافقة إدارية قبل الاستمرار بالتصعيد القانوني.`
        : `رصيد الدين (${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}) يتجاوز الحد المسموح للتحصيل الآلي (50,000 ${ctx.debt.currency}) — يحتاج مراجعة وتفويض إداري صريح للاستمرار.`

    await insertApproval({
      company_id:    ctx.debt.company_id,
      approval_type,
      title:         `${approval_type === 'legal_escalation' ? 'تصعيد قانوني' : 'رصيد كبير يحتاج تفويض'}: ${ctx.customer.full_name}`,
      description:   [
        reasonLine,
        `المرجع: ${ctx.debt.reference_number} — الرصيد: ${ctx.debt.current_balance.toLocaleString()} ${ctx.debt.currency}${daysOverdue !== null ? ` — متأخر ${daysOverdue} يوم` : ''}${ctx.debt.last_contact_result ? ` — آخر نتيجة تواصل: ${ctx.debt.last_contact_result}` : ''}`,
        `القرار: الموافقة = تفويض إداري بالاستمرار. الرفض = إيقاف حتى مراجعة إضافية.`,
      ].join('\n'),
      entity_type:   'debt',
      entity_id:     ctx.debt.id,
      requested_data: { debt_id: ctx.debt.id, customer: ctx.customer.full_name,
                        balance: ctx.debt.current_balance, currency: ctx.debt.currency,
                        status: ctx.debt.status, reference: ctx.debt.reference_number },
      priority:      'urgent',
      expires_at:    new Date(Date.now() + 48 * 3600000).toISOString(),
    })
  } catch (err) {
    log.warn(`stepApprovals(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Step: Unified Live Event Reactor
// Converts any inbound meaning into real system updates.
// ─────────────────────────────────────────────────────────────────────────────

async function stepLiveReactor(ctx: Ctx, event?: PipelineEvent): Promise<number> {
  const text = String(event?.data?.message ?? event?.data?.customer_statement ?? event?.data?.note ?? '').trim()
  if (!text) return 0

  const rawIntent = detectCustomerIntent(text)
  const hasPromiseTime =
    text.includes('بكرة') || text.includes('بكره') ||
    text.includes('نهاية الشهر') || text.includes('اخر الشهر') || text.includes('آخر الشهر') ||
    text.includes('يوم') || text.includes('تاريخ') ||
    text.toLowerCase().includes('tomorrow')
  const intent = rawIntent === 'payment_intent' && hasPromiseTime ? 'promise' : rawIntent
  if (!intent || intent === 'unknown') return 0

  const sb = createServiceClient()
  let changed = 0

  async function addTimeline(event_type: string, summary: string, detail?: Record<string, unknown>) {
    await insertTimelineEvent({
      company_id: ctx.debt.company_id,
      customer_id: ctx.debt.customer_id,
      debt_id: ctx.debt.id,
      event_type: event_type as any,
      channel: String(event?.source ?? '').includes('webhook') ? 'whatsapp' : 'system',
      summary,
      detail: JSON.stringify({ intent, text, ...(detail ?? {}) }).slice(0, 1000),
      actor_type: 'customer',
      ai_used: true,
      metadata: { source: event?.source ?? 'unknown', intent, debt_id: ctx.debt.id },
    })
    changed++
  }

  if (intent === 'promise') {
    await addTimeline('promise_detected', `وعد سداد من العميل: ${ctx.customer.full_name}`)
  }

  if (intent === 'refusal') {
    const { error: refusalErr } = await sb.from('debts').update({
      priority: 'high',
      last_contact_result: 'Customer refused to pay via inbound message',
    }).eq('id', ctx.debt.id).eq('company_id', ctx.debt.company_id)
    if (refusalErr) log.warn(`stepLiveReactor(${ctx.debt.id}) refusal debt-update failed: ${refusalErr.message}`)

    await insertSystemAlert({
      company_id: ctx.debt.company_id,
      severity: 'error',
      alert_type: 'customer_refusal',
      title: `رفض سداد: ${ctx.customer.full_name}`,
      message: text.slice(0, 500),
      metadata: { debt_id: ctx.debt.id, customer_id: ctx.customer.id, intent, source: event?.source ?? 'unknown' },
    })

    await addTimeline('refusal_detected', `رفض سداد من العميل: ${ctx.customer.full_name}`)
    changed++
  }

  if (intent === 'dispute' || intent === 'wrong_number') {
    const { error: disputeErr } = await sb.from('debts').update({
      status: 'disputed',
      priority: 'high',
      last_contact_result: 'Customer dispute detected from inbound message',
    }).eq('id', ctx.debt.id).eq('company_id', ctx.debt.company_id)
    if (disputeErr) log.warn(`stepLiveReactor(${ctx.debt.id}) dispute debt-update failed: ${disputeErr.message}`)

    // Real duplication this fixes: this used to build its own separate,
    // bare approval (approval_type='stop_followup', no request_subtype) for
    // every dispute-looking message, alongside src/lib/dispute.ts's
    // recordDispute() — which already does this properly (real customer
    // context/excerpt, request_subtype='dispute', and real PATCH-time
    // effects in the approvals dashboard). Two independent mechanisms
    // reacting to the same signal produced two differently-shaped,
    // duplicate approvals per dispute, only one of which actually did
    // anything when decided. recordDispute() already dedupes against any
    // open/under_review dispute for this debt, so calling it here is safe
    // to repeat on every qualifying message.
    await recordDispute({
      company_id: ctx.debt.company_id,
      customer_id: ctx.customer.id,
      customer_name: ctx.customer.full_name,
      debt_id: ctx.debt.id,
      customer_message: text,
    })

    await addTimeline('dispute_detected', `اعتراض يحتاج مراجعة: ${ctx.customer.full_name}`)
    changed++
  }

  if (intent === 'paid_claim') {
    // Real dead-end this fixes: the old bare approval here (approval_type=
    // 'stop_followup', no request_subtype) had no PATCH-time effect —
    // approving/rejecting it changed nothing, and nothing stopped a fresh
    // duplicate firing on the customer's next reply. recordPaymentClaim()
    // (src/lib/payment-claim.ts) dedupes against an existing pending claim
    // and is wired to a real decision in the approvals PATCH route.
    await recordPaymentClaim({
      company_id: ctx.debt.company_id,
      customer_id: ctx.customer.id,
      customer_name: ctx.customer.full_name,
      debt_id: ctx.debt.id,
      customer_message: text,
    })

    await addTimeline('payment_claim_detected', `العميل أفاد بالسداد/التحويل: ${ctx.customer.full_name}`)
    changed++
  }

  if (intent === 'legal_threat' || intent === 'angry') {
    await insertSystemAlert({
      company_id: ctx.debt.company_id,
      severity: 'warning',
      alert_type: intent === 'legal_threat' ? 'legal_escalation' : 'angry_customer',
      title: `${intent === 'legal_threat' ? 'تصعيد قانوني' : 'عميل غاضب'}: ${ctx.customer.full_name}`,
      message: text.slice(0, 500),
      metadata: { debt_id: ctx.debt.id, customer_id: ctx.customer.id, intent, source: event?.source ?? 'unknown' },
    })

    await addTimeline(intent === 'legal_threat' ? 'legal_escalation_detected' : 'angry_customer_detected', text.slice(0, 120))
    changed++
  }

  return changed
}

async function stepAISystemImpact(ctx: Ctx, event: PipelineEvent, score: ScoreResult): Promise<string[]> {
  const impact = event.data?.ai_system_impact as Record<string, unknown> | undefined
  if (!impact) return ['ai_impact:none']

  const sb = createServiceClient()
  const done: string[] = []
  const message = String(event.data?.message ?? event.data?.customer_statement ?? event.data?.note ?? '').trim()
  const summary = String(impact.summary ?? 'AI system impact processed')
  const riskImpact = String(impact.risk_impact ?? 'neutral')
  const isWebhook = String(event.source ?? '').includes('webhook')

  if (impact.timeline) {
    // 'ai_system_impact' was never a valid timeline_events.event_type
    // (only a fixed list is allowed) — this insert has been silently
    // failing every time since it shipped; 'ai_analysis' is the correct,
    // valid semantic fit. done.push() below used to fire unconditionally
    // regardless of whether the insert actually succeeded — now gated on it.
    const { error: teErr } = await sb.from('timeline_events').insert({
      company_id: ctx.debt.company_id,
      customer_id: ctx.debt.customer_id,
      debt_id: ctx.debt.id,
      event_type: 'ai_analysis',
      channel: isWebhook ? 'whatsapp' : 'system',
      summary,
      detail: JSON.stringify({ message, impact, source: event.source }).slice(0, 1000),
      actor_type: 'ai',
      ai_used: true,
      metadata: { source: event.source, debt_id: ctx.debt.id, ai_system_impact: true },
      occurred_at: new Date().toISOString(),
    })
    if (teErr) log.error('ai_system_impact timeline insert failed', new Error(teErr.message), { debt_id: ctx.debt.id })
    else done.push('ai_impact:timeline')
  }

  // ai_memory disabled — see stepMemory() above.

  if (impact.promise) {
    const today = new Date().toISOString().split('T')[0]
    const promisedDate =
      message.includes('بكرة') || message.includes('بكره') || message.toLowerCase().includes('tomorrow')
        ? new Date(Date.now() + 86400000).toISOString().split('T')[0]
        : new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0]

    const { data: existingPromise } = await sb.from('promises')
      .select('id')
      .eq('company_id', ctx.debt.company_id)
      .eq('debt_id', ctx.debt.id)
      .eq('status', 'pending')
      .gte('promised_date', today)
      .limit(1)

    if (!(existingPromise?.length)) {
      const { error: promiseInsertErr } = await sb.from('promises').insert({
        company_id: ctx.debt.company_id,
        customer_id: ctx.debt.customer_id,
        debt_id: ctx.debt.id,
        promised_amount: ctx.debt.current_balance,
        promised_date: promisedDate,
        channel: isWebhook ? 'whatsapp' : 'system',
        status: 'pending',
        notes: message ? `AI system impact promise: ${message}` : summary,
      })
      if (promiseInsertErr) log.warn(`stepAISystemImpact(${ctx.debt.id}) promise insert failed: ${promiseInsertErr.message}`)
      else done.push('ai_impact:promise')
    } else {
      done.push('ai_impact:promise_exists')
    }
  }

  if (impact.alert) {
    await insertSystemAlert({
      company_id: ctx.debt.company_id,
      severity: riskImpact === 'critical' ? 'error' : 'warning',
      alert_type: riskImpact === 'critical' ? 'ai_critical_event' : 'ai_risk_event',
      title: `AI Alert: ${ctx.customer.full_name}`,
      message: summary.slice(0, 500),
      metadata: { debt_id: ctx.debt.id, customer_id: ctx.customer.id, source: event.source, impact, message },
    })
    done.push('ai_impact:alert')
  }

  if (impact.approval) {
    const { data: existingApproval } = await sb.from('approvals')
      .select('id')
      .eq('company_id', ctx.debt.company_id)
      .eq('entity_id', ctx.debt.id)
      .eq('status', 'pending')
      .maybeSingle()

    if (!existingApproval) {
      const inserted = await insertApproval({
        company_id: ctx.debt.company_id,
        approval_type: 'stop_followup',
        title: `AI Review: ${ctx.customer.full_name}`,
        description: summary.slice(0, 1000),
        entity_type: 'debt',
        entity_id: ctx.debt.id,
        requested_data: { debt_id: ctx.debt.id, customer_id: ctx.customer.id, message, impact },
        priority: riskImpact === 'critical' ? 'urgent' : 'high',
        expires_at: new Date(Date.now() + 48 * 3600000).toISOString(),
      })
      if (inserted) done.push('ai_impact:approval')
    } else {
      done.push('ai_impact:approval_exists')
    }
  }

  if (impact.debt_update) {
    const patch: Record<string, unknown> = {}
    if (riskImpact === 'critical' || riskImpact === 'increase') patch.priority = 'high'
    if (riskImpact === 'critical') patch.status = 'disputed'
    patch.last_contact_result = summary.slice(0, 250)

    const { error: debtUpdateErr } = await sb.from('debts')
      .update(patch)
      .eq('company_id', ctx.debt.company_id)
      .eq('id', ctx.debt.id)

    if (debtUpdateErr) log.warn(`stepAISystemImpact(${ctx.debt.id}) debt update failed: ${debtUpdateErr.message}`)
    else done.push('ai_impact:debt_update')
  }

  if (impact.ai_action) {
    const { error: actionInsertErr } = await sb.from('ai_actions').insert({
      company_id: ctx.debt.company_id,
      debt_id: ctx.debt.id,
      customer_id: ctx.debt.customer_id,
      assigned_to: null,
      action_type: isWebhook ? 'whatsapp' : 'call',
      priority: riskImpact === 'critical' ? 'critical' : riskImpact === 'increase' ? 'high' : 'medium',
      priority_score: score.score,
      reason: summary.slice(0, 300),
      suggested_message: message.slice(0, 300),
      status: 'pending',
      scheduled_for: new Date().toISOString().split('T')[0],
      metadata: { source: event.source, ai_system_impact: impact },
    })
    if (actionInsertErr) log.warn(`stepAISystemImpact(${ctx.debt.id}) ai_actions insert failed: ${actionInsertErr.message}`)
    else done.push('ai_impact:ai_action')
  }

  done.push('ai_impact:dashboard_ready')
  return done
}
// ─────────────────────────────────────────────────────────────────────────────
// Step: Campaign eligibility
// ─────────────────────────────────────────────────────────────────────────────

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
        const { error: campUpdateErr } = await sb.from('campaigns')
          .update({ target_count: Number(camp.target_count ?? 0) + 1 })
          .eq('id', camp.id)
        if (campUpdateErr) log.warn(`stepCampaigns(${ctx.debt.id}) campaign target_count update failed: ${campUpdateErr.message}`)
      }
    }
  } catch (err) {
    log.warn(`stepCampaigns(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step: WhatsApp queue (LIVE only)
// ─────────────────────────────────────────────────────────────────────────────

async function stepWhatsApp(ctx: Ctx): Promise<boolean> {
  const phone = ctx.customer.whatsapp ?? ctx.customer.phone
  if (!phone) return false
  const daysOverdue = ctx.debt.due_date ? calculateDaysOverdue(ctx.debt.due_date) : 0
  if (daysOverdue <= 0) return false
  if (ACTIVE_NEGOTIATION_STATUSES.includes(ctx.debt.status)) return false

  const nameIsArabicWA = /[\u0600-\u06FF]/.test(ctx.customer.full_name ?? '')
  const waBal = ctx.debt.current_balance.toLocaleString('en-SA')
  const msg = nameIsArabicWA
    ? `هلا ${ctx.customer.full_name}، عندك مبلغ ${waBal} ${ctx.debt.currency} (مرجع: ${ctx.debt.reference_number}). نقدر نرتب طريقة سداد تناسبك.`
    : `Hi ${ctx.customer.full_name}, reminder about your ${ctx.debt.currency} ${waBal} balance (ref: ${ctx.debt.reference_number}). We can arrange a payment plan for you.`
  try {
    // Was returning `true` unconditionally right after the insert call —
    // Supabase's JS client never throws on a failed insert (constraint
    // violation, etc.), it just returns {error}, so a silently-failed queue
    // insert was reported as a successful WhatsApp-queue step every time.
    const { error: queueErr } = await createServiceClient().from('job_queue').insert({
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
    if (queueErr) { log.warn(`stepWhatsApp(${ctx.debt.id}) job_queue insert failed: ${queueErr.message}`); return false }
    return true
  } catch (err) {
    log.warn(`stepWhatsApp(${ctx.debt.id}): ` + (err instanceof Error ? err.message : String(err)))
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main: processEvent
// ─────────────────────────────────────────────────────────────────────────────

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

    // ── AI Memory (always) ──────────────────────────────────────────
    try {
      R.memory_count = await stepMemory(ctx)
      R.steps_completed.push(`memory:${R.memory_count}`)
    } catch { R.steps_failed.push('memory') }

    // ── AI Score (always — OFF/TEST/LIVE) ───────────────────────────
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

    // ── AI System Impact Executor (always, when provided by AI) ──────
    try {
      const impactSteps = await stepAISystemImpact(ctx, event, score)
      for (const s of impactSteps) {
        if (s === 'ai_impact:none') R.steps_skipped.push(s)
        else R.steps_completed.push(s)
      }
    } catch { R.steps_failed.push('ai_system_impact') }
    // ── Timeline (always) ───────────────────────────────────────────
    try {
      const ok = await stepTimeline(ctx, event.source, score, event.data)
      ok ? R.steps_completed.push('timeline') : R.steps_failed.push('timeline')
    } catch { R.steps_failed.push('timeline') }

    // ── Unified Live Event Reactor (always) ──────────────────────────
    try {
      const reactions = await stepLiveReactor(ctx, event)
      if (reactions > 0) R.steps_completed.push('reactor:changed')
      else R.steps_skipped.push('reactor:no_intent')
    } catch { R.steps_failed.push('reactor') }

    // ── AI Action (TEST + LIVE only) ─────────────────────────────────
    if (cfg.mode !== 'off') {
      try {
        const created = await stepAction(ctx, score, today)
        if (created) { R.ai_actions_count++; R.steps_completed.push('action:created') }
        else R.steps_skipped.push('action:duplicate')
      } catch { R.steps_failed.push('action') }
    } else {
      R.steps_skipped.push('action:mode_off')
    }

    // ── Rules (always) ──────────────────────────────────────────────
    try {
      const matches = await stepRules(ctx, score)
      R.steps_completed.push(`rules:${matches.length ? matches.join(',') : 'none'}`)
    } catch { R.steps_failed.push('rules') }

    // ── Alerts (always) ─────────────────────────────────────────────
    try {
      R.alerts_count = await stepAlerts(ctx, score)
      R.steps_completed.push(`alerts:${R.alerts_count}`)
    } catch { R.steps_failed.push('alerts') }

    // ── Promises (always) ───────────────────────────────────────────
    try {
      await stepPromises(ctx, event)
      R.steps_completed.push('promises')
    } catch { R.steps_failed.push('promises') }

    // ── Approvals (always) ──────────────────────────────────────────
    try {
      await stepApprovals(ctx)
      R.steps_completed.push('approvals')
    } catch { R.steps_failed.push('approvals') }

    // ── Campaigns (always) ──────────────────────────────────────────
    try {
      await stepCampaigns(ctx)
      R.steps_completed.push('campaigns')
    } catch { R.steps_failed.push('campaigns') }

    // ── WhatsApp (LIVE only) ─────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Batch processor
// ─────────────────────────────────────────────────────────────────────────────

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











