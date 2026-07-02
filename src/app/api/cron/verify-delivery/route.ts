import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { insertSystemAlert } from '@/lib/system-alerts'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/verify-delivery')

// WhatsApp Web (WAHA) can report a send as "successful" with a message ID
// even when the message was actually swallowed in transit — most commonly
// on the first-ever message to a brand-new contact, while the e2e session
// is still being established. Our DB only learns the TRUE delivery state
// from the message.ack webhook, which upgrades status to delivered/read.
//
// 🔴 SAFETY (incident 2026-06-19): an earlier version of this job retried
// EVERY stuck message independently. For a customer whose session is
// permanently broken (never delivers anything), that meant every single
// past AI reply in the conversation got rediscovered as "stuck" on
// successive 5-minute runs and re-sent — effectively replaying an entire
// old conversation, including escalation/legal-threat lines, back-to-back
// in one burst. Fixed by reasoning PER CUSTOMER, not per message:
//   - If a customer has never once had a message reach delivered/read,
//     their session is treated as broken — we stop sending to them
//     entirely (no retries) and raise a one-time alert for manual fix.
//   - Otherwise, retry at most the SINGLE most-recent stuck message for
//     that customer per run. Older stuck messages are marked failed
//     without ever being re-sent.
const STUCK_AFTER_MIN = 2   // give real acks this long to arrive
const TOO_OLD_MIN = 60      // don't chase very old sends forever
const MAX_PER_RUN = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const now = Date.now()
  const stuckBefore = new Date(now - STUCK_AFTER_MIN * 60_000).toISOString()
  const tooOldBefore = new Date(now - TOO_OLD_MIN * 60_000).toISOString()

  const { data: stuck } = await supabase
    .from('messages')
    .select('id, company_id, customer_id, debt_id, content, sent_at, metadata')
    .eq('channel', 'whatsapp').eq('direction', 'outbound').eq('status', 'sent')
    .lte('sent_at', stuckBefore).gte('sent_at', tooOldBefore)
    .order('sent_at', { ascending: true })
    .limit(MAX_PER_RUN)

  const result = { checked: stuck?.length ?? 0, retried: 0, markedFailedNoResend: 0, brokenSessionsSkipped: 0, correctedToFailed: 0, skipped: 0 }

  // Group by customer so we never act on more than one stuck message per
  // customer per run, and so we can check session health once per customer.
  const byCustomer = new Map<string, Array<NonNullable<typeof stuck>[number]>>()
  for (const m of stuck ?? []) {
    const cid = (m as { customer_id: string }).customer_id
    if (!byCustomer.has(cid)) byCustomer.set(cid, [])
    byCustomer.get(cid)!.push(m)
  }

  for (const [customerId, msgs] of Array.from(byCustomer.entries())) {
    // Has this customer EVER had a message actually confirmed delivered/read?
    // If not, their session is broken — stop sending to them entirely.
    const { data: everDelivered } = await supabase
      .from('messages').select('id')
      .eq('customer_id', customerId).eq('channel', 'whatsapp').eq('direction', 'outbound')
      .in('status', ['delivered', 'read'])
      .limit(1).maybeSingle()

    if (!everDelivered) {
      // Distinguish a BRAND-NEW customer whose first message was swallowed
      // during e2e session setup (WhatsApp Web drops the very first message to
      // a new contact while the encryption handshake runs) from a genuinely
      // broken session. Give the newest message ONE bounded retry — the first
      // attempt warms the e2e session, so the resend usually lands. Only after
      // a retry has already been attempted (and still nothing delivered) do we
      // declare the session broken and stop. This reuses the single-message,
      // single-retry safety from the healthy path — no mass resends.
      const sortedNew = [...msgs].sort((a, b) =>
        new Date((b as { sent_at: string }).sent_at).getTime() - new Date((a as { sent_at: string }).sent_at).getTime())
      const [newest, ...olderNew] = sortedNew
      const newestMeta = (newest as { metadata?: Record<string, unknown> }).metadata ?? {}
      const alreadyTried = !!newestMeta.retry_attempted || !!newestMeta.retry_of

      // Older stuck messages are marked failed without ever being re-sent.
      for (const m of olderNew) {
        const meta = (m as { metadata?: Record<string, unknown> }).metadata ?? {}
        const { error: olderFailErr } = await supabase.from('messages').update({
          status: 'failed', metadata: { ...meta, delivery_unconfirmed: true },
        }).eq('id', (m as { id: string }).id)
        if (olderFailErr) log.error('verify-delivery: failed to mark older stuck message failed', new Error(olderFailErr.message), { message_id: (m as { id: string }).id })
        result.correctedToFailed++
      }

      if (!alreadyTried) {
        // First-contact retry: mark the swallowed original failed, resend once.
        const { error: newestFailErr } = await supabase.from('messages').update({
          status: 'failed', metadata: { ...newestMeta, delivery_unconfirmed: true, retry_attempted: true },
        }).eq('id', (newest as { id: string }).id)
        if (newestFailErr) log.error('verify-delivery: failed to mark newest message failed pre-retry', new Error(newestFailErr.message), { message_id: (newest as { id: string }).id })
        result.correctedToFailed++

        const { data: customer } = await supabase
          .from('customers').select('phone, whatsapp').eq('id', customerId).maybeSingle()
        const phone = (customer as { whatsapp?: string; phone?: string } | null)?.whatsapp
          || (customer as { whatsapp?: string; phone?: string } | null)?.phone
        if (!phone) { result.skipped++; continue }

        const r = await sendWhatsAppMessage({
          to: phone, message: String((newest as { content: string }).content),
          company_id: (newest as { company_id: string }).company_id,
        })
        if (r.status === 'sent') {
          const { error: firstRetryInsertErr } = await supabase.from('messages').insert({
            company_id: (newest as { company_id: string }).company_id, customer_id: customerId,
            debt_id: (newest as { debt_id: string | null }).debt_id,
            channel: 'whatsapp', direction: 'outbound',
            content: String((newest as { content: string }).content),
            status: 'sent', whatsapp_message_id: r.message_id || null,
            metadata: { ...newestMeta, retry_of: (newest as { id: string }).id, first_contact_retry: true },
            sent_at: new Date().toISOString(),
          })
          if (firstRetryInsertErr) log.error('verify-delivery: first-contact retry message log failed', new Error(firstRetryInsertErr.message), { customer_id: customerId })
          result.retried++
        } else {
          result.markedFailedNoResend++
        }
        continue
      }

      // Retry already attempted and STILL nothing delivered → broken session.
      const { error: brokenSessionErr } = await supabase.from('messages').update({
        status: 'failed', metadata: { ...newestMeta, delivery_unconfirmed: true, session_broken: true },
      }).eq('id', (newest as { id: string }).id)
      if (brokenSessionErr) log.error('verify-delivery: failed to mark broken-session message failed', new Error(brokenSessionErr.message), { message_id: (newest as { id: string }).id })
      result.correctedToFailed++
      result.brokenSessionsSkipped++

      const { data: existingAlert } = await supabase
        .from('system_alerts').select('id').eq('alert_type', 'whatsapp_session_broken')
        .eq('is_resolved', false).contains('metadata', { customer_id: customerId }).limit(1).maybeSingle()
      if (!existingAlert) {
        await insertSystemAlert({
          company_id: (msgs[0] as { company_id: string }).company_id, severity: 'critical',
          alert_type: 'whatsapp_session_broken',
          title: 'جلسة واتساب معطوبة مع عميل — لا تصل أي رسالة',
          message: `لم تصل أي رسالة لهذا العميل رغم إعادة المحاولة. توقف النظام عن الإرسال له تلقائياً. الحل: اطلب من العميل إرسال أي رسالة للبوت أولاً لإعادة فتح الجلسة.`,
          metadata: { customer_id: customerId, stuck_count: msgs.length },
        })
      }
      continue
    }

    // Healthy session, just a transient miss — retry only the single most
    // recent stuck message; mark any older ones failed without resending.
    const sorted = [...msgs].sort((a, b) =>
      new Date((b as { sent_at: string }).sent_at).getTime() - new Date((a as { sent_at: string }).sent_at).getTime())
    const [latest, ...rest] = sorted

    for (const m of rest) {
      const meta = (m as { metadata?: Record<string, unknown> }).metadata ?? {}
      const { error: restFailErr } = await supabase.from('messages').update({
        status: 'failed',
        metadata: { ...meta, delivery_unconfirmed: true },
      }).eq('id', (m as { id: string }).id)
      if (restFailErr) log.error('verify-delivery: failed to mark older stuck message failed (healthy session)', new Error(restFailErr.message), { message_id: (m as { id: string }).id })
      result.markedFailedNoResend++
      result.correctedToFailed++
    }

    const meta = (latest as { metadata?: Record<string, unknown> }).metadata ?? {}
    const alreadyRetried = !!meta.retry_of || !!meta.retry_attempted
    if (alreadyRetried) {
      const { error: alreadyRetriedErr } = await supabase.from('messages').update({
        status: 'failed',
        metadata: { ...meta, delivery_unconfirmed: true },
      }).eq('id', (latest as { id: string }).id)
      if (alreadyRetriedErr) log.error('verify-delivery: failed to mark already-retried message failed', new Error(alreadyRetriedErr.message), { message_id: (latest as { id: string }).id })
      result.markedFailedNoResend++
      result.correctedToFailed++
      continue
    }

    const { data: customer } = await supabase
      .from('customers').select('phone, whatsapp').eq('id', customerId).maybeSingle()
    const phone = (customer as { whatsapp?: string; phone?: string } | null)?.whatsapp
      || (customer as { whatsapp?: string; phone?: string } | null)?.phone
    if (!phone) { result.skipped++; continue }

    const r = await sendWhatsAppMessage({
      to: phone, message: String((latest as { content: string }).content),
      company_id: (latest as { company_id: string }).company_id,
    })

    const { error: preRetryFailErr } = await supabase.from('messages').update({
      status: 'failed',
      metadata: { ...meta, delivery_unconfirmed: true, retry_attempted: true },
    }).eq('id', (latest as { id: string }).id)
    if (preRetryFailErr) log.error('verify-delivery: failed to mark message failed pre-retry (healthy session)', new Error(preRetryFailErr.message), { message_id: (latest as { id: string }).id })
    result.correctedToFailed++

    if (r.status === 'sent') {
      const { error: retryInsertErr } = await supabase.from('messages').insert({
        company_id: (latest as { company_id: string }).company_id,
        customer_id: customerId,
        debt_id: (latest as { debt_id: string | null }).debt_id,
        channel: 'whatsapp', direction: 'outbound',
        content: String((latest as { content: string }).content),
        status: 'sent', whatsapp_message_id: r.message_id || null,
        metadata: { ...meta, retry_of: (latest as { id: string }).id },
        sent_at: new Date().toISOString(),
      })
      if (retryInsertErr) log.error('verify-delivery: retry message log failed', new Error(retryInsertErr.message), { customer_id: customerId })
      result.retried++
    } else {
      result.markedFailedNoResend++
    }
  }

  if (result.correctedToFailed > 0) {
    const { data: existing } = await supabase
      .from('system_alerts').select('id').eq('alert_type', 'whatsapp_delivery_unconfirmed')
      .eq('is_resolved', false).is('company_id', null).limit(1).maybeSingle()
    if (!existing) {
      await insertSystemAlert({
        company_id: null, severity: 'warning', alert_type: 'whatsapp_delivery_unconfirmed',
        title: 'رسائل واتساب لم يتأكد تسليمها',
        message: `${result.correctedToFailed} رسالة لم تصل فعلياً رغم ظهورها "مرسَلة" — تم تصحيح حالتها إلى "فشل" (أقصى رسالة واحدة أُعيد إرسالها لكل عميل، لا إعادة إرسال جماعية).`,
        metadata: result,
      })
    }
  }

  log.info('verify-delivery run', result)
  return NextResponse.json({ message: 'done', result })
}
