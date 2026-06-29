// Single source of truth for timeline_events' three constrained columns —
// mirrors timeline_events_event_type_check / _channel_check / _actor_type_check
// in the database exactly (see supabase/migrations/001_initial_schema.sql).
//
// Root-cause fix for a real, repeated production bug class found during a
// full-system audit (2026-06-29): at least 7 separate call sites across the
// codebase wrote string literals like 'outcome_classified', 'bot_action',
// 'promise_made', 'disputed', 'note_added', 'legal_escalation',
// 'ai_system_impact', 'collection_sync', 'whatsapp_inbound' into
// timeline_events.event_type — none of which are valid against the real
// CHECK constraint. Supabase's JS client never throws on a constraint
// violation (it returns {error}), and none of those call sites checked it,
// so every one of those timeline entries silently never existed, for every
// company, since each feature shipped — yet debts.status and other "real"
// writes succeeded fine in the same request, making the gap invisible.
//
// Using these literal union types means TypeScript itself rejects an
// invalid value at the call site, at compile time, regardless of which
// file or future feature writes to this table — this is the part that
// makes the fix permanent rather than a one-off patch.
export type TimelineEventType =
  | 'whatsapp_in' | 'whatsapp_out' | 'call_in' | 'call_out' | 'ai_reply'
  | 'collector_note' | 'promise_to_pay' | 'payment' | 'status_change'
  | 'ai_analysis' | 'rule_triggered' | 'campaign' | 'human_handoff' | 'escalation'

export type TimelineChannel = 'whatsapp' | 'call' | 'email' | 'sms' | 'system' | 'ai' | 'manual'

export type TimelineActorType = 'ai' | 'collector' | 'customer' | 'system' | 'campaign'

export interface TimelineEventRow {
  company_id: string
  customer_id?: string | null
  debt_id?: string | null
  event_type: TimelineEventType
  channel: TimelineChannel
  actor_type: TimelineActorType
  actor_id?: string | null
  actor_name?: string | null
  summary: string
  detail?: string | null
  ai_used?: boolean
  amount?: number | null
  cost_usd?: number | null
  metadata?: Record<string, unknown> | null
  occurred_at?: string
}

/**
 * The ONLY function in the codebase that should insert into timeline_events
 * — every other call site found during the 2026-06-29 audit was migrated to
 * this. Always checks and logs the error (Supabase never throws on a
 * constraint violation), so a future bug here is loud, not silent.
 */
export async function insertTimelineEvent(
  supabase: { from: (table: string) => any },
  row: TimelineEventRow,
  logger?: { error: (msg: string, err?: Error, ctx?: Record<string, unknown>) => void },
): Promise<boolean> {
  const { error } = await supabase.from('timeline_events').insert({
    ...row,
    occurred_at: row.occurred_at ?? new Date().toISOString(),
  })
  if (error) {
    const msg = `timeline_events insert failed: ${error.message ?? error}`
    if (logger) logger.error(msg, undefined, { event_type: row.event_type, debt_id: row.debt_id })
    else console.error(msg, { event_type: row.event_type, debt_id: row.debt_id })
    return false
  }
  return true
}
