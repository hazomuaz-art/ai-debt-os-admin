import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import type { TimelineEventType, TimelineActorType, TimelineChannel } from '@/types/index'

const log = createLogger('timeline')

// The permanent fix for a full-system audit finding (2026-06-29): 9
// separate timeline_events inserts scattered across the codebase used
// event_type/actor_type values outside the real CHECK constraints, all
// failing silently for months (Supabase's JS client returns {error}, it
// never throws). event_type/actor_type/channel are typed against the
// REAL constraint lists (types/index.ts) — passing anything else is now a
// compile-time error (tsc, run before every deploy), not a runtime
// surprise discovered later. Every NEW timeline write should go through
// this, not a raw `.from('timeline_events').insert(...)`.
//
// Replaces the previous createTimelineEvent() in this file, which was
// dead code (zero callers anywhere) AND broken even if it had been called
// — it inserted `title`/`description`, columns that don't exist on
// timeline_events at all (the real columns are `summary`/`detail`).
export async function insertTimelineEvent(row: {
  company_id: string
  customer_id?: string | null
  debt_id?: string | null
  event_type: TimelineEventType
  channel: TimelineChannel
  actor_type: TimelineActorType
  actor_name?: string | null
  summary: string
  detail?: string | null
  ai_used?: boolean
  metadata?: Record<string, unknown>
}): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('timeline_events').insert({
    company_id: row.company_id,
    customer_id: row.customer_id ?? null,
    debt_id: row.debt_id ?? null,
    event_type: row.event_type,
    channel: row.channel,
    actor_type: row.actor_type,
    actor_name: row.actor_name ?? null,
    summary: row.summary,
    detail: row.detail ?? null,
    ai_used: row.ai_used ?? false,
    metadata: row.metadata ?? {},
    occurred_at: new Date().toISOString(),
  })
  if (error) log.error('timeline_events insert failed', new Error(error.message), { event_type: row.event_type })
}
