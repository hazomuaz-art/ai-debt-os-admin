/**
 * AI Revenue Attribution
 *
 * Records every AI-initiated event that has financial significance —
 * a promise the agent recorded, an AI-confirmed payment (receipt OCR), a
 * debt the AI closed, or a dispute/escalation it opened — plus manual
 * collector payments (primary_actor='collector'). Writes to
 * `collection_attribution` (the real, already-existing table — NOT
 * `revenue_events`, which does not exist and was the reason this whole
 * module silently recorded nothing for its entire history).
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('revenue-attribution')

// Must match the collection_attribution.primary_channel CHECK constraint.
export type AttributionChannel =
  | 'whatsapp' | 'call' | 'ai_reply' | 'collector' | 'campaign' | 'self_service' | 'unknown'

// Must match the collection_attribution.primary_actor / supporting_actor CHECK constraint.
export type AttributionActor = 'ai' | 'collector' | 'ai_assisted' | 'campaign' | 'customer' | 'unknown'

// 'payment' = AI/collector confirmed a payment that did NOT fully close the
// debt. 'settlement' = the same kind of confirmation, but it DID close the
// debt (current_balance reached 0) — mutually exclusive for the same
// payment. 'promise'/'dispute'/'escalation' carry no real collected
// revenue; `amount` for those is contextual (promised amount / balance at
// time of dispute), not money in hand — getChannelSummary /
// getAIvsHumanSummary filter to payment+settlement only.
export type AttributionEventType = 'promise' | 'payment' | 'settlement' | 'dispute' | 'escalation'

export interface AttributionInput {
  company_id:          string
  event_type:          AttributionEventType
  // Idempotency anchor for payment/settlement events — the real payments.id.
  payment_id?:         string
  // Idempotency anchor for promise/dispute/escalation events — the
  // promises.id / disputes.id this attribution row represents. Prevents a
  // retried webhook call from duplicating the SAME promise/dispute; a
  // genuinely new promise/dispute later on the same debt gets its own row.
  source_id?:          string
  customer_id:         string
  debt_id:             string
  amount:              number
  primary_channel:     AttributionChannel
  primary_actor:       AttributionActor
  // Set when a human had to step in on what was otherwise an AI-driven
  // event — never claim full AI credit when there was real human
  // intervention in the same event.
  supporting_actor?:   AttributionActor | null
  ai_assisted?:        boolean
  rule_used?:          boolean
  memory_used?:        boolean
  campaign_id?:        string
  collector_id?:       string
  portfolio_id?:       string
  touches_before_pay?: number
  days_to_collect?:    number
}

/**
 * Record an attribution event. Idempotent: relies on the DB unique
 * indexes (payment_id / source_id / debt_id+event_type=settlement) — a
 * duplicate call is treated as success, not an error, and never throws.
 * Never breaks the caller's flow: any failure is caught and logged as a
 * clear warning, the caller continues regardless.
 */
export async function recordAttribution(input: AttributionInput): Promise<string | null> {
  try {
    const sb = createServiceClient()
    const { data, error } = await sb
      .from('collection_attribution')
      .insert({
        company_id:         input.company_id,
        event_type:         input.event_type,
        payment_id:         input.payment_id        ?? null,
        source_id:          input.source_id         ?? null,
        customer_id:        input.customer_id,
        debt_id:            input.debt_id,
        amount:             input.amount,
        primary_channel:    input.primary_channel,
        primary_actor:      input.primary_actor,
        supporting_actor:   input.supporting_actor   ?? null,
        ai_assisted:        input.ai_assisted        ?? false,
        rule_used:          input.rule_used          ?? false,
        memory_used:        input.memory_used        ?? false,
        campaign_id:        input.campaign_id        ?? null,
        collector_id:       input.collector_id       ?? null,
        portfolio_id:       input.portfolio_id       ?? null,
        touches_before_pay: input.touches_before_pay ?? 1,
        days_to_collect:    input.days_to_collect    ?? null,
      })
      .select('id')
      .single()

    if (error) {
      // 23505 = unique_violation -> this exact event was already recorded
      // (idempotent retry, e.g. a re-delivered webhook). Not a real error.
      if ((error as { code?: string }).code === '23505') {
        log.info('attribution already recorded, skipping duplicate', { event_type: input.event_type, payment_id: input.payment_id, source_id: input.source_id })
        return null
      }
      log.warn('recordAttribution insert failed: ' + error.message, { event_type: input.event_type, debt_id: input.debt_id })
      return null
    }
    return (data as { id: string }).id
  } catch (err) {
    log.warn('recordAttribution failed: ' + (err instanceof Error ? err.message : String(err)), { event_type: input.event_type, debt_id: input.debt_id })
    return null
  }
}

export interface ChannelSummary {
  channel:      AttributionChannel
  total_amount: number
  count:        number
  avg_days:     number
}

/** Revenue by channel for a period — payment/settlement rows only (real collected money). */
export async function getChannelSummary(
  companyId: string,
  periodStart: string,
  periodEnd:   string,
): Promise<ChannelSummary[]> {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('collection_attribution')
      .select('primary_channel, amount, days_to_collect')
      .eq('company_id', companyId)
      .in('event_type', ['payment', 'settlement'])
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)

    if (!data?.length) return []

    const map = new Map<string, { total: number; count: number; days: number }>()
    for (const row of data as Array<{ primary_channel: string; amount: number; days_to_collect: number | null }>) {
      const key = row.primary_channel
      const cur = map.get(key) ?? { total: 0, count: 0, days: 0 }
      cur.total += Number(row.amount ?? 0)
      cur.count += 1
      cur.days  += Number(row.days_to_collect ?? 0)
      map.set(key, cur)
    }

    return Array.from(map.entries()).map(([channel, v]) => ({
      channel:      channel as AttributionChannel,
      total_amount: v.total,
      count:        v.count,
      avg_days:     v.count > 0 ? Math.round(v.days / v.count) : 0,
    })).sort((a, b) => b.total_amount - a.total_amount)
  } catch (err) {
    log.warn('getChannelSummary failed: ' + (err instanceof Error ? err.message : String(err)))
    return []
  }
}

/** AI-collected vs human-collected revenue summary — payment/settlement rows only. */
export async function getAIvsHumanSummary(companyId: string, since: string) {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('collection_attribution')
      .select('primary_actor, amount, ai_assisted')
      .eq('company_id', companyId)
      .in('event_type', ['payment', 'settlement'])
      .gte('created_at', since)

    if (!data?.length) return { ai: 0, human: 0, ai_assisted: 0, ai_count: 0, human_count: 0 }

    const rows = data as Array<{ primary_actor: string; amount: number; ai_assisted: boolean }>
    return rows.reduce(
      (acc, row) => {
        const amt = Number(row.amount ?? 0)
        if (row.primary_actor === 'ai') { acc.ai += amt; acc.ai_count++ }
        else if (row.ai_assisted)       { acc.ai_assisted += amt }
        else                            { acc.human += amt; acc.human_count++ }
        return acc
      },
      { ai: 0, human: 0, ai_assisted: 0, ai_count: 0, human_count: 0 },
    )
  } catch (err) {
    log.warn('getAIvsHumanSummary failed: ' + (err instanceof Error ? err.message : String(err)))
    return { ai: 0, human: 0, ai_assisted: 0, ai_count: 0, human_count: 0 }
  }
}
