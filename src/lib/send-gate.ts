import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('send-gate')

// Same window the user specified: after one unanswered unprompted message,
// stay silent until either the customer replies or 3 full days pass.
export const FOLLOW_UP_AFTER_MS = 3 * 24 * 60 * 60 * 1000

export type SendGateResult =
  | { allowed: true }
  | { allowed: false; reason: 'customer_in_active_conversation' | 'awaiting_reply_within_window' | 'whatsapp_session_unhealthy' }

/**
 * Single Decision Engine for every UNPROMPTED outbound message (campaign
 * blasts, proactive reminders, promise follow-ups) — i.e. any message the
 * system sends without the customer having just written in. This is the
 * root-cause fix for a real production incident (2026-07-06): dozens of
 * customers received 3-5 "campaign" messages each with zero reply in
 * between. The campaign queue's own per-row retry counter was the only
 * thing limiting resends, and it has no idea whether the CUSTOMER ever
 * responded — it only tracks whether OUR OWN send attempt technically
 * succeeded. A customer who never replies must get exactly one message,
 * then silence, until they reply or 3 days pass. This function is the only
 * place that rule is expressed, and every unprompted-send code path must
 * call it immediately before dispatch — never decide independently.
 */
export async function canSendUnpromptedMessage(customerId: string): Promise<SendGateResult> {
  const supabase = createServiceClient()
  const { data: last } = await supabase
    .from('messages')
    .select('direction, sent_at')
    .eq('customer_id', customerId)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!last) return { allowed: true } // never contacted — first send always allowed

  const row = last as { direction: string; sent_at: string }
  if (row.direction === 'inbound') {
    // The customer is mid-conversation with the agent (they replied most
    // recently) — a campaign/reminder blast must never interrupt that; the
    // normal reply pipeline (waha-webhook) already owns this customer.
    return { allowed: false, reason: 'customer_in_active_conversation' }
  }

  const elapsed = Date.now() - new Date(row.sent_at).getTime()
  if (elapsed < FOLLOW_UP_AFTER_MS) {
    return { allowed: false, reason: 'awaiting_reply_within_window' }
  }
  return { allowed: true }
}

/**
 * Circuit breaker: true only when there is no unresolved GLOBAL WhatsApp
 * connectivity/delivery alert. Root-cause fix for the same incident — the
 * health-check cron correctly detected and alerted a WAHA disconnection at
 * 11:30 and a total delivery failure at 12:00, but nothing consulted those
 * alerts before continuing to attempt sends. Any unprompted-send cron must
 * check this FIRST, before spending an LLM call or a WAHA request on a
 * session that is already known to be broken.
 *
 * 🔴 Scope bug this fixes (2026-07-08): 'whatsapp_session_broken' used to be
 * included here too, but that alert is raised PER CUSTOMER (by
 * verify-delivery.ts, when one specific customer's messages never confirm
 * delivered even after a retry) — it says nothing about the connection
 * overall. Confirmed live: 17 of these per-customer alerts from an earlier
 * incident sat unresolved and would have silently blocked the ENTIRE
 * campaign for every OTHER customer too, forever, until someone noticed and
 * manually cleared 17 individual rows. Only alert types that describe the
 * WHOLE session/connection belong in a GLOBAL gate.
 */
export async function isWhatsAppSessionHealthy(): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('system_alerts')
    .select('id')
    .in('alert_type', ['whatsapp_disconnected', 'whatsapp_delivery_failure'])
    .eq('is_resolved', false)
    .limit(1)
    .maybeSingle()
  if (error) {
    // Fail closed on an unreadable health signal — refusing to send is
    // always the safer default than blasting into an unknown state.
    log.error('health check query failed — treating session as unhealthy', new Error(error.message))
    return false
  }
  return !data
}

export type QualityCheckResult = { healthy: boolean; total: number; delivered: number; ratio: number }

/**
 * Real-time delivery-quality circuit breaker — checked INLINE by the
 * campaign sender itself, independent of the whatsapp-health cron's own
 * schedule. Root cause this closes: this number was silently blocked by
 * WhatsApp TWICE (2026-06-30: 0% delivered on 11 messages; 2026-07-06: 25%
 * delivered on 149 messages before the disconnect alert even fired) — by
 * the time the periodic health cron caught it, dozens of messages had
 * already gone out into a degrading session. A campaign sender must check
 * its OWN recent delivery ratio before every batch, not just trust that an
 * external alert will arrive in time. Threshold is intentionally stricter
 * (0.5, vs the health cron's 0.3) and the window shorter (60 min, vs 3h) —
 * catch degradation early and stop, rather than confirm it's already bad.
 */
export async function isDeliveryQualityHealthy(windowMinutes = 60, minSample = 5, minRatio = 0.5): Promise<QualityCheckResult> {
  const supabase = createServiceClient()
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString() // give WAHA's ack webhook time to land
  const { data } = await supabase
    .from('messages')
    .select('status')
    .eq('direction', 'outbound').eq('channel', 'whatsapp')
    .eq('metadata->>action_type', 'campaign')
    .gte('sent_at', since).lte('sent_at', cutoff)
    .limit(500)

  const rows = (data ?? []) as { status: string }[]
  const total = rows.length
  const delivered = rows.filter(r => ['delivered', 'read'].includes(r.status)).length
  const ratio = total ? delivered / total : 1
  const healthy = total < minSample || ratio >= minRatio
  return { healthy, total, delivered, ratio: Number(ratio.toFixed(2)) }
}

/**
 * Meta-Business-Platform-inspired warm-up tiering: a brand-new or recently
 * reconnected WhatsApp number does not get to send at its full configured
 * daily_limit from day one — it ramps up over several days, exactly like
 * WhatsApp Business API's own messaging tiers (new numbers start at a low
 * tier and only scale up as quality/volume holds). This number's own
 * history (two silent-block incidents in its first 6 days) is precisely
 * the failure mode Meta's tiering exists to prevent, so the ramp here is
 * intentionally conservative — capped well below the account's configured
 * daily_limit for the first several days after any (re)connection.
 */
export async function getWarmupDailyLimit(numberId: string, configuredLimit: number): Promise<number> {
  const supabase = createServiceClient()
  const { data: lastReconnect } = await supabase
    .from('system_alerts')
    .select('resolved_at')
    .eq('alert_type', 'whatsapp_disconnected')
    .contains('metadata', { whatsapp_number_id: numberId })
    .not('resolved_at', 'is', null)
    .order('resolved_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: number } = await supabase
    .from('portfolio_whatsapp_numbers')
    .select('created_at')
    .eq('id', numberId)
    .maybeSingle()

  const anchor = (lastReconnect as { resolved_at: string } | null)?.resolved_at
    ?? (number as { created_at: string } | null)?.created_at
    ?? new Date().toISOString()

  const daysSinceAnchor = (Date.now() - new Date(anchor).getTime()) / (24 * 3600_000)
  if (daysSinceAnchor < 2) return Math.min(configuredLimit, 30)
  if (daysSinceAnchor < 5) return Math.min(configuredLimit, 80)
  if (daysSinceAnchor < 10) return Math.min(configuredLimit, 150)
  return configuredLimit
}

/**
 * Jittered pacing between real sends — a perfectly uniform interval (the
 * previous fixed 10s delay) is itself a bot fingerprint; real human/business
 * WhatsApp usage has natural variance. Widened and randomized specifically
 * because this number already has two block incidents on record — err
 * toward slower and less mechanical, not faster.
 */
export function jitteredSendDelayMs(minMs = 20_000, maxMs = 45_000): number {
  return minMs + Math.floor(Math.random() * (maxMs - minMs))
}
