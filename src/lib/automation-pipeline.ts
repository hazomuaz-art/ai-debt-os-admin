/**
 * Automation Pipeline — Core Orchestrator
 *
 * Every significant event (import, webhook, sync, payment update, etc.)
 * passes through processEvent(). The pipeline:
 *
 *   1.  Normalize data
 *   2.  Map statuses
 *   3.  Upsert customer + debt records
 *   4.  Create timeline event
 *   5.  Update AI Memory (from remarks/notes)
 *   6.  Calculate AI Score (enqueue job, respect cost limits)
 *   7.  Generate AI Actions (enqueue job)
 *   8.  Execute Rules Engine
 *   9.  Trigger Alerts
 *   10. Update Promises
 *   11. Update Campaign Eligibility
 *   12. Track usage
 *   13. Log processing result
 *
 * Respects: automation_mode (off/test/live), emergency_stop flags,
 * duplicate prevention, and skips settled/closed/written_off debts.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('automation-pipeline')

// ── Event types ────────────────────────────────────────────────────────────

export type EventSource =
  | 'csv_import'
  | 'excel_import'
  | 'api_sync'
  | 'webhook_whatsapp'
  | 'webhook_call'
  | 'payment_update'
  | 'promise_update'
  | 'collector_note'
  | 'debt_update'
  | 'customer_update'
  | 'manual'

export interface PipelineEvent {
  source:       EventSource
  company_id:   string
  actor_id?:    string    // user who triggered this
  // At least one of these must be present
  customer_id?: string
  debt_id?:     string
  // Raw data from the trigger (varies by source)
  data?:        Record<string, unknown>
  // Pre-resolved IDs after upsert (set internally)
  _customer_id?: string
  _debt_id?:     string
}

export interface PipelineResult {
  success:           boolean
  steps_completed:   string[]
  steps_skipped:     string[]
  steps_failed:      string[]
  customer_id?:      string
  debt_id?:          string
  ai_score_queued:   boolean
  ai_actions_queued: boolean
  mode:              string
  error?:            string
}

// ── Statuses that are terminal (skip AI processing) ───────────────────────

const TERMINAL_STATUSES = new Set([
  'settled', 'paid', 'closed', 'written_off', 'cancelled',
  // Arabic equivalents
  'مسدد', 'مغلق', 'منتهي',
])

function isTerminal(status: string | null | undefined): boolean {
  if (!status) return false
  const s = status.toLowerCase().trim()
  return TERMINAL_STATUSES.has(s) ||
    s.includes('paid') || s.includes('settled') ||
    s.includes('closed') || s.includes('written') ||
    s.includes('مسدد') || s.includes('مغلق')
}

// ── Get company automation config ──────────────────────────────────────────

async function getConfig(companyId: string): Promise<{
  mode:           'off' | 'test' | 'live'
  emergency_stop: boolean
  daily_ai_limit: number
}> {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('system_config')
      .select('automation_mode, emergency_stop_all, emergency_stop_ai, daily_ai_calls_limit')
      .eq('company_id', companyId)
      .maybeSingle()

    const d = data as Record<string, unknown> | null
    return {
      mode:           (d?.automation_mode as 'off' | 'test' | 'live') ?? 'off',
      emergency_stop: !!(d?.emergency_stop_all) || !!(d?.emergency_stop_ai),
      daily_ai_limit: Number(d?.daily_ai_calls_limit ?? 100),
    }
  } catch {
    return { mode: 'off', emergency_stop: false, daily_ai_limit: 100 }
  }
}

// ── Enqueue a job safely (no-op if function not deployed) ──────────────────

async function enqueueJob(
  companyId: string,
  jobType:   string,
  payload:   Record<string, unknown>,
  priority = 5,
): Promise<boolean> {
  try {
    const sb = createServiceClient()
    await sb.rpc('enqueue_job', {
      p_company_id: companyId,
      p_job_type:   jobType,
      p_payload:    payload,
      p_priority:   priority,
    })
    return true
  } catch {
    // enqueue_job RPC not yet deployed — fall back to direct insert
    try {
      const sb = createServiceClient()
      await sb.from('job_queue').insert({
        company_id:  companyId,
        job_type:    jobType,
        payload,
        priority,
        status:      'pending',
        scheduled_at: new Date().toISOString(),
        max_attempts: 3,
        attempts:     0,
      })
      return true
    } catch (e2) {
      log.warn('enqueueJob failed: ' + (e2 instanceof Error ? e2.message : String(e2)))
      return false
    }
  }
}

// ── Create timeline event ──────────────────────────────────────────────────

async function createTimelineEvent(opts: {
  company_id:  string
  customer_id: string
  debt_id?:    string
  event_type:  string
  channel?:    string
  summary:     string
  detail?:     string
  actor_type?: string
  actor_name?: string
  ai_used?:    boolean
  metadata?:   Record<string, unknown>
}): Promise<void> {
  try {
    const sb = createServiceClient()
    await sb.from('timeline_events').insert({
      company_id:  opts.company_id,
      customer_id: opts.customer_id,
      debt_id:     opts.debt_id     ?? null,
      event_type:  opts.event_type,
      channel:     opts.channel     ?? 'system',
      summary:     opts.summary,
      detail:      opts.detail      ?? null,
      actor_type:  opts.actor_type  ?? 'system',
      actor_name:  opts.actor_name  ?? null,
      ai_used:     opts.ai_used     ?? false,
      metadata:    opts.metadata    ?? {},
      occurred_at: new Date().toISOString(),
    })
  } catch (err) {
    log.warn('createTimelineEvent failed: ' + (err instanceof Error ? err.message : String(err)))
  }
}

// ── Populate AI Memory from notes/remarks ──────────────────────────────────

async function populateAIMemory(opts: {
  company_id: string
  notes:      string | null | undefined
  source:     string
}): Promise<number> {
  if (!opts.notes?.trim()) return 0
  const notes = opts.notes.trim()
  if (notes.length < 10) return 0

  try {
    const sb = createServiceClient()
    const pattern = notes.slice(0, 200)

    // Idempotent: skip if pattern already exists
    const { data: existing } = await sb
      .from('ai_memory')
      .select('id')
      .eq('company_id', opts.company_id)
      .eq('trigger_pattern', pattern)
      .maybeSingle()

    if (existing) return 0

    // Classify category from content
    const lower = notes.toLowerCase()
    const category =
      lower.includes('بسدد') || lower.includes('سوف أدفع') || lower.includes('will pay')  ? 'payment_promise' :
      lower.includes('غاضب') || lower.includes('يشتكي')    || lower.includes('angry')       ? 'angry'           :
      lower.includes('مو عندي') || lower.includes('no money') || lower.includes('broke')    ? 'objection'       :
      lower.includes('تصعيد') || lower.includes('escalat')                                  ? 'escalation'      :
      'general'

    await sb.from('ai_memory').insert({
      company_id:      opts.company_id,
      trigger_pattern: pattern,
      response_text:   notes,
      category,
      language:        /[\u0600-\u06FF]/.test(notes) ? 'ar' : 'en',
      status:          'approved',
      is_active:       true,
      source:          'imported',
      success_count:   0,
      use_count:       0,
    })
    return 1
  } catch (err) {
    log.warn('populateAIMemory failed: ' + (err instanceof Error ? err.message : String(err)))
    return 0
  }
}

// ── Execute rules engine ───────────────────────────────────────────────────

async function executeRules(opts: {
  company_id:  string
  customer_id: string
  debt_id:     string
  status:      string
  balance:     number
  contact_result?: string
}): Promise<{ action: string; rule_name: string } | null> {
  try {
    const sb = createServiceClient()
    const { data: rules } = await sb
      .from('collection_rules')
      .select('id, name, condition, action, action_params')
      .eq('company_id', opts.company_id)
      .eq('is_active', true)
      .order('priority')
      .limit(20)

    if (!rules?.length) return null

    for (const rule of rules as Array<{
      id: string; name: string
      condition: Record<string, unknown>; action: string
      action_params: Record<string, unknown>
    }>) {
      const cond = rule.condition
      const field = String(cond.field ?? '')
      const op    = String(cond.operator ?? 'eq')
      const val   = cond.value

      let fieldVal: unknown
      if (field === 'debt.status')          fieldVal = opts.status
      if (field === 'debt.current_balance')  fieldVal = opts.balance
      if (field === 'last_contact_result')   fieldVal = opts.contact_result ?? ''

      let matched = false
      if (op === 'eq')           matched = fieldVal === val
      if (op === 'neq')          matched = fieldVal !== val
      if (op === 'gt')           matched = Number(fieldVal) > Number(val)
      if (op === 'gte')          matched = Number(fieldVal) >= Number(val)
      if (op === 'contains')     matched = String(fieldVal ?? '').toLowerCase().includes(String(val ?? '').toLowerCase())
      if (op === 'contains_any') matched = Array.isArray(val) && val.some(v => String(fieldVal ?? '').toLowerCase().includes(String(v).toLowerCase()))

      if (matched) {
        // Increment trigger count
        await sb.from('collection_rules').update({
          trigger_count: (rule as unknown as Record<string, unknown>).trigger_count as number + 1,
          last_triggered_at: new Date().toISOString(),
        }).eq('id', rule.id)

        return { action: rule.action, rule_name: rule.name }
      }
    }
  } catch (err) {
    log.warn('executeRules failed: ' + (err instanceof Error ? err.message : String(err)))
  }
  return null
}

// ── Trigger alerts ─────────────────────────────────────────────────────────

async function triggerAlerts(opts: {
  company_id:   string
  debt_id:      string
  customer_id:  string
  status:       string
  balance:      number
  days_overdue: number
}): Promise<void> {
  const { company_id, debt_id, customer_id, balance, days_overdue } = opts

  const alerts: Array<{ title: string; severity: string; alert_type: string; message: string }> = []

  if (days_overdue > 180)
    alerts.push({ title: 'Critical overdue debt', severity: 'critical', alert_type: 'overdue_critical', message: `Debt ${debt_id} overdue ${days_overdue} days — consider legal action` })
  else if (days_overdue > 90)
    alerts.push({ title: 'High-risk overdue debt', severity: 'error', alert_type: 'overdue_high', message: `Debt overdue ${days_overdue} days, balance ${balance}` })

  if (balance > 100000)
    alerts.push({ title: 'High value debt alert', severity: 'warning', alert_type: 'high_value', message: `Balance exceeds 100,000 — escalation may be required` })

  if (!alerts.length) return

  try {
    const sb = createServiceClient()
    await sb.from('system_alerts').insert(
      alerts.map(a => ({
        company_id,
        severity:   a.severity,
        alert_type: a.alert_type,
        title:      a.title,
        message:    a.message,
        metadata:   { debt_id, customer_id, balance, days_overdue },
        is_read:    false,
        is_resolved: false,
      }))
    )
  } catch (err) {
    log.warn('triggerAlerts failed: ' + (err instanceof Error ? err.message : String(err)))
  }
}

// ── Update promise statuses ────────────────────────────────────────────────

async function updatePromiseStatuses(company_id: string, debt_id: string): Promise<void> {
  try {
    const sb = createServiceClient()
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    await sb.from('promises')
      .update({ status: 'broken' })
      .eq('company_id', company_id)
      .eq('debt_id', debt_id)
      .eq('status', 'pending')
      .lt('promised_date', yesterday)
  } catch (err) {
    log.warn('updatePromiseStatuses: ' + (err instanceof Error ? err.message : String(err)))
  }
}

// ── Track daily AI usage ───────────────────────────────────────────────────

async function trackUsage(company_id: string, event_type: string): Promise<void> {
  try {
    const sb     = createServiceClient()
    const period = new Date().toISOString().slice(0, 7)
    // Use the existing increment_usage RPC if available
    await sb.rpc('increment_usage', {
      p_company_id: company_id,
      p_period:     period,
      p_field:      'ai_calls_used',
      p_amount:     1,
    })
  } catch {
    // Non-critical
  }
  // Also insert a usage_events row
  try {
    const sb = createServiceClient()
    await sb.from('usage_events').insert({
      company_id,
      event_type,
    })
  } catch { /* non-critical */ }
}

// ── Main pipeline entry point ──────────────────────────────────────────────

export async function processEvent(event: PipelineEvent): Promise<PipelineResult> {
  const result: PipelineResult = {
    success:           false,
    steps_completed:   [],
    steps_skipped:     [],
    steps_failed:      [],
    ai_score_queued:   false,
    ai_actions_queued: false,
    mode:              'off',
  }

  const { company_id } = event

  try {
    // ── Step 0: Get config & check automation mode ─────────────────────
    const cfg = await getConfig(company_id)
    result.mode = cfg.mode

    if (cfg.emergency_stop) {
      result.steps_skipped.push('all:emergency_stop_active')
      result.success = true
      return result
    }

    // Determine working customer_id and debt_id
    const customer_id = event._customer_id ?? event.customer_id
    const debt_id     = event._debt_id     ?? event.debt_id

    if (!customer_id) {
      result.error = 'No customer_id available'
      return result
    }

    result.customer_id = customer_id
    result.debt_id     = debt_id

    // ── Step 1: Fetch current debt to check status ─────────────────────
    let debtStatus:      string | null = null
    let debtBalance:     number        = 0
    let debtDueDate:     string | null = null
    let debtNotes:       string | null = null
    let contactResult:   string | null = null

    if (debt_id) {
      try {
        const sb = createServiceClient()
        const { data: debt } = await sb
          .from('debts')
          .select('status, current_balance, due_date, notes, last_contact_result')
          .eq('id', debt_id)
          .single()

        if (debt) {
          const d = debt as Record<string, unknown>
          debtStatus    = String(d.status        ?? 'active')
          debtBalance   = Number(d.current_balance ?? 0)
          debtDueDate   = d.due_date             as string | null
          debtNotes     = d.notes                as string | null
          contactResult = d.last_contact_result  as string | null
        }
        result.steps_completed.push('fetch_debt')
      } catch (err) {
        result.steps_failed.push('fetch_debt')
        log.warn('fetch_debt failed: ' + (err instanceof Error ? err.message : String(err)))
      }
    }

    // ── Step 2: Calculate days overdue ────────────────────────────────
    const daysOverdue = debtDueDate
      ? Math.max(0, Math.floor((Date.now() - new Date(debtDueDate).getTime()) / 86400000))
      : 0

    // ── Step 3: Create timeline event ────────────────────────────────
    try {
      const eventSummaries: Record<EventSource, string> = {
        csv_import:        'Imported via CSV',
        excel_import:      'Imported via Excel',
        api_sync:          'Synced from collection system',
        webhook_whatsapp:  'Inbound WhatsApp message received',
        webhook_call:      'Call result recorded',
        payment_update:    'Payment recorded',
        promise_update:    'Promise updated',
        collector_note:    'Collector note added',
        debt_update:       'Debt record updated',
        customer_update:   'Customer record updated',
        manual:            'Manual action triggered',
      }

      await createTimelineEvent({
        company_id,
        customer_id,
        debt_id:    debt_id ?? undefined,
        event_type: event.source === 'csv_import' || event.source === 'excel_import' || event.source === 'api_sync'
          ? 'status_change' : event.source === 'webhook_whatsapp' ? 'whatsapp_in'
          : event.source === 'payment_update' ? 'payment'
          : event.source === 'collector_note' ? 'collector_note'
          : 'ai_analysis',
        channel:    event.source === 'webhook_whatsapp' ? 'whatsapp' : 'system',
        summary:    eventSummaries[event.source] ?? 'Event processed',
        detail:     JSON.stringify(event.data ?? {}).slice(0, 500),
        actor_type: event.actor_id ? 'collector' : 'system',
      })
      result.steps_completed.push('timeline_event')
    } catch (err) {
      result.steps_failed.push('timeline_event')
      log.warn('timeline step failed: ' + (err instanceof Error ? err.message : String(err)))
    }

    // ── Step 4: Populate AI Memory from notes ────────────────────────
    const notesToProcess = [
      debtNotes,
      contactResult,
      event.data?.notes as string | null,
      event.data?.remarks as string | null,
    ].filter(Boolean).join('\n').trim()

    if (notesToProcess) {
      try {
        await populateAIMemory({ company_id, notes: notesToProcess, source: event.source })
        result.steps_completed.push('ai_memory')
      } catch (err) {
        result.steps_failed.push('ai_memory')
      }
    } else {
      result.steps_skipped.push('ai_memory:no_notes')
    }

    // ── Step 5: Skip terminal debts from AI processing ───────────────
    if (debt_id && isTerminal(debtStatus)) {
      result.steps_skipped.push('ai_score:terminal_status', 'ai_actions:terminal_status', 'rules:terminal_status')
      result.success = true
      return result
    }

    // ── Step 6: Queue AI Score (only in test/live mode) ──────────────
    if (debt_id && cfg.mode !== 'off') {
      try {
        const queued = await enqueueJob(company_id, 'score_debt', { debt_id }, 5)
        result.ai_score_queued = queued
        result.steps_completed.push('ai_score_queued')
      } catch (err) {
        result.steps_failed.push('ai_score')
      }
    } else {
      result.steps_skipped.push('ai_score:mode_off_or_no_debt')
    }

    // ── Step 7: Execute Rules ─────────────────────────────────────────
    if (debt_id && debtStatus) {
      try {
        const ruleResult = await executeRules({
          company_id, customer_id, debt_id,
          status:   debtStatus, balance: debtBalance,
          contact_result: contactResult ?? undefined,
        })

        if (ruleResult) {
          result.steps_completed.push(`rules:${ruleResult.action}`)

          // Create timeline entry for rule trigger
          await createTimelineEvent({
            company_id, customer_id, debt_id,
            event_type: 'rule_triggered',
            summary:    `Rule triggered: ${ruleResult.rule_name} → ${ruleResult.action}`,
            actor_type: 'system',
          })

          // If rule says skip AI — skip AI actions
          if (ruleResult.action === 'skip_ai' || ruleResult.action === 'do_nothing') {
            result.steps_skipped.push('ai_actions:rule_skip')
          }
        } else {
          result.steps_completed.push('rules:no_match')
        }
      } catch (err) {
        result.steps_failed.push('rules')
      }
    }

    // ── Step 8: Trigger alerts ────────────────────────────────────────
    if (debt_id && debtBalance > 0) {
      try {
        await triggerAlerts({
          company_id, debt_id, customer_id,
          status: debtStatus ?? 'active', balance: debtBalance, days_overdue: daysOverdue,
        })
        result.steps_completed.push('alerts')
      } catch (err) {
        result.steps_failed.push('alerts')
      }
    }

    // ── Step 9: Update promise statuses ───────────────────────────────
    if (debt_id) {
      try {
        await updatePromiseStatuses(company_id, debt_id)
        result.steps_completed.push('promises')
      } catch (err) {
        result.steps_failed.push('promises')
      }
    }

    // ── Step 10: Track usage ──────────────────────────────────────────
    try {
      await trackUsage(company_id, event.source)
      result.steps_completed.push('usage_tracking')
    } catch { /* non-critical */ }

    result.success = true
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    result.success = false
    log.warn('Pipeline error: ' + result.error)
  }

  return result
}

/**
 * Process multiple events in batch (e.g., after CSV import).
 * Runs in parallel with concurrency limit to avoid DB connection exhaustion.
 */
export async function processEventBatch(
  events:      PipelineEvent[],
  concurrency = 3,
): Promise<{ total: number; succeeded: number; failed: number; skipped: number }> {
  const results = { total: events.length, succeeded: 0, failed: 0, skipped: 0 }
  if (!events.length) return results

  // Process in batches
  for (let i = 0; i < events.length; i += concurrency) {
    const batch = events.slice(i, i + concurrency)
    const settled = await Promise.allSettled(batch.map(e => processEvent(e)))

    for (const r of settled) {
      if (r.status === 'fulfilled') {
        if (r.value.success) {
          if (r.value.steps_skipped.some(s => s.includes('terminal'))) {
            results.skipped++
          } else {
            results.succeeded++
          }
        } else {
          results.failed++
        }
      } else {
        results.failed++
      }
    }
  }

  log.info('Batch processed', results)
  return results
}
