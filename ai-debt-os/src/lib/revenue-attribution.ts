/**
 * Revenue Attribution Foundation
 *
 * Records every payment with its collection attribution:
 * which channel (WhatsApp, call, AI, etc.) and actor (AI, collector,
 * campaign) caused the customer to pay.
 *
 * Also provides aggregation queries for the ROI dashboard.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('revenue-attribution')

export type AttributionChannel =
  | 'whatsapp' | 'call' | 'ai_call' | 'email' | 'sms'
  | 'collector' | 'campaign' | 'self_service' | 'unknown'

export type AttributionActor = 'ai' | 'collector' | 'ai_assisted' | 'campaign' | 'customer' | 'unknown'

export interface AttributionInput {
  company_id:          string
  payment_id?:         string
  customer_id:         string
  debt_id:             string
  amount:              number
  currency?:           string
  attribution_channel: AttributionChannel
  attribution_actor:   AttributionActor
  ai_assisted?:        boolean
  rule_triggered?:     boolean
  memory_used?:        boolean
  campaign_id?:        string
  collector_id?:       string
  portfolio_id?:       string
  touches_before?:     number
  days_to_collect?:    number
  cost_of_collection?: number
}

/** Record a revenue attribution event */
export async function recordAttribution(input: AttributionInput): Promise<string | null> {
  try {
    const sb  = createServiceClient()
    const roi = input.cost_of_collection && input.cost_of_collection > 0
      ? ((input.amount - input.cost_of_collection) / input.cost_of_collection) * 100
      : null

    const { data, error } = await sb
      .from('revenue_events')
      .insert({
        company_id:          input.company_id,
        payment_id:          input.payment_id          ?? null,
        customer_id:         input.customer_id,
        debt_id:             input.debt_id,
        amount:              input.amount,
        currency:            input.currency            ?? 'SAR',
        attribution_channel: input.attribution_channel,
        attribution_actor:   input.attribution_actor,
        ai_assisted:         input.ai_assisted         ?? false,
        rule_triggered:      input.rule_triggered      ?? false,
        memory_used:         input.memory_used         ?? false,
        campaign_id:         input.campaign_id         ?? null,
        collector_id:        input.collector_id        ?? null,
        portfolio_id:        input.portfolio_id        ?? null,
        touches_before:      input.touches_before      ?? 1,
        days_to_collect:     input.days_to_collect     ?? null,
        cost_of_collection:  input.cost_of_collection  ?? 0,
        roi,
      })
      .select('id')
      .single()

    if (error) {
      log.warn('recordAttribution insert failed: ' + error.message)
      return null
    }
    return (data as { id: string }).id
  } catch (err) {
    log.warn('recordAttribution failed: ' + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

export interface ChannelSummary {
  channel:     AttributionChannel
  total_amount: number
  count:       number
  avg_days:    number
  avg_roi:     number
}

/** Get revenue attribution summary by channel for a period */
export async function getChannelSummary(
  companyId: string,
  periodStart: string,
  periodEnd:   string,
): Promise<ChannelSummary[]> {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('revenue_events')
      .select('attribution_channel, amount, days_to_collect, roi')
      .eq('company_id', companyId)
      .gte('collected_at', periodStart)
      .lte('collected_at', periodEnd)

    if (!data?.length) return []

    const map = new Map<string, { total: number; count: number; days: number; roi: number }>()
    for (const row of data as Array<{ attribution_channel: string; amount: number; days_to_collect: number | null; roi: number | null }>) {
      const key = row.attribution_channel
      const cur = map.get(key) ?? { total: 0, count: 0, days: 0, roi: 0 }
      cur.total += Number(row.amount ?? 0)
      cur.count += 1
      cur.days  += Number(row.days_to_collect ?? 0)
      cur.roi   += Number(row.roi ?? 0)
      map.set(key, cur)
    }

    return Array.from(map.entries()).map(([channel, v]) => ({
      channel:      channel as AttributionChannel,
      total_amount: v.total,
      count:        v.count,
      avg_days:     v.count > 0 ? Math.round(v.days / v.count) : 0,
      avg_roi:      v.count > 0 ? Math.round(v.roi  / v.count) : 0,
    })).sort((a, b) => b.total_amount - a.total_amount)
  } catch (err) {
    log.warn('getChannelSummary failed: ' + (err instanceof Error ? err.message : String(err)))
    return []
  }
}

/** AI-collected vs human-collected summary */
export async function getAIvsHumanSummary(companyId: string, since: string) {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('revenue_events')
      .select('attribution_actor, amount, ai_assisted')
      .eq('company_id', companyId)
      .gte('collected_at', since)

    if (!data?.length) return { ai: 0, human: 0, ai_assisted: 0, ai_count: 0, human_count: 0 }

    const rows = data as Array<{ attribution_actor: string; amount: number; ai_assisted: boolean }>
    return rows.reduce(
      (acc, row) => {
        const amt = Number(row.amount ?? 0)
        if (row.attribution_actor === 'ai') { acc.ai += amt; acc.ai_count++ }
        else if (row.ai_assisted)           { acc.ai_assisted += amt }
        else                                { acc.human += amt; acc.human_count++ }
        return acc
      },
      { ai: 0, human: 0, ai_assisted: 0, ai_count: 0, human_count: 0 },
    )
  } catch (err) {
    log.warn('getAIvsHumanSummary failed: ' + (err instanceof Error ? err.message : String(err)))
    return { ai: 0, human: 0, ai_assisted: 0, ai_count: 0, human_count: 0 }
  }
}
