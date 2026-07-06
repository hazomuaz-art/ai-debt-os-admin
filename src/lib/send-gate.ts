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
 * Circuit breaker: true only when there is no unresolved WhatsApp
 * connectivity/delivery alert. Root-cause fix for the same incident — the
 * health-check cron correctly detected and alerted a WAHA disconnection at
 * 11:30 and a total delivery failure at 12:00, but nothing consulted those
 * alerts before continuing to attempt sends. Any unprompted-send cron must
 * check this FIRST, before spending an LLM call or a WAHA request on a
 * session that is already known to be broken.
 */
export async function isWhatsAppSessionHealthy(): Promise<boolean> {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('system_alerts')
    .select('id')
    .in('alert_type', ['whatsapp_disconnected', 'whatsapp_delivery_failure', 'whatsapp_session_broken'])
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
