import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/verify-delivery')

// WhatsApp Web (WAHA) can report a send as "successful" with a message ID
// even when the message was actually swallowed in transit — most commonly
// on the first-ever message to a brand-new contact, while the e2e session
// is still being established. Our DB only learns the TRUE delivery state
// from the message.ack webhook, which upgrades status to delivered/read.
// If a message is still stuck at "sent" well after it should have been
// acked, it almost certainly never arrived — this run finds those, retries
// each ONCE, and marks the original honestly as "failed" so reporting
// (especially future campaigns) never shows false positives.
const STUCK_AFTER_MIN = 2   // give real acks this long to arrive
const TOO_OLD_MIN = 60      // don't chase very old sends forever
const MAX_PER_RUN = 30

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const result = { checked: stuck?.length ?? 0, retried: 0, markedFailed: 0, correctedToFailed: 0, skipped: 0 }

  for (const m of stuck ?? []) {
    const meta = (m as { metadata?: Record<string, unknown> }).metadata ?? {}
    const alreadyRetried = !!meta.retry_of || !!meta.retry_attempted
    if (alreadyRetried) {
      // This was already a retry, or already retried once — stop chasing,
      // just record it honestly as undelivered.
      await supabase.from('messages').update({
        status: 'failed',
        metadata: { ...meta, delivery_unconfirmed: true },
      }).eq('id', (m as { id: string }).id)
      result.markedFailed++
      result.correctedToFailed++
      continue
    }

    const { data: customer } = await supabase
      .from('customers').select('phone, whatsapp').eq('id', (m as { customer_id: string }).customer_id).maybeSingle()
    const phone = (customer as { whatsapp?: string; phone?: string } | null)?.whatsapp
      || (customer as { whatsapp?: string; phone?: string } | null)?.phone
    if (!phone) { result.skipped++; continue }

    const r = await sendWhatsAppMessage({
      to: phone, message: String((m as { content: string }).content),
      company_id: (m as { company_id: string }).company_id,
    })

    // Mark the original honestly — it was never confirmed delivered,
    // regardless of whether the retry itself appears to have gone through.
    await supabase.from('messages').update({
      status: 'failed',
      metadata: { ...meta, delivery_unconfirmed: true, retry_attempted: true },
    }).eq('id', (m as { id: string }).id)
    result.correctedToFailed++

    if (r.status === 'sent') {
      await supabase.from('messages').insert({
        company_id: (m as { company_id: string }).company_id,
        customer_id: (m as { customer_id: string }).customer_id,
        debt_id: (m as { debt_id: string | null }).debt_id,
        channel: 'whatsapp', direction: 'outbound',
        content: String((m as { content: string }).content),
        status: 'sent', whatsapp_message_id: r.message_id || null,
        metadata: { ...meta, retry_of: (m as { id: string }).id },
        sent_at: new Date().toISOString(),
      })
      result.retried++
    } else {
      result.markedFailed++
    }
  }

  // Dashboard visibility — never let undelivered messages hide silently.
  if (result.correctedToFailed > 0) {
    const { data: existing } = await supabase
      .from('system_alerts').select('id').eq('alert_type', 'whatsapp_delivery_unconfirmed')
      .eq('is_resolved', false).is('company_id', null).limit(1).maybeSingle()
    if (!existing) {
      await supabase.from('system_alerts').insert({
        company_id: null, severity: 'warning', alert_type: 'whatsapp_delivery_unconfirmed',
        title: 'رسائل واتساب لم يتأكد تسليمها',
        message: `${result.correctedToFailed} رسالة لم تصل فعلياً رغم ظهورها "مرسَلة" — تم تصحيح حالتها إلى "فشل" وإعادة محاولة الإرسال حيث أمكن.`,
        metadata: result, is_read: false, is_resolved: false,
      })
    }
  }

  log.info('verify-delivery run', result)
  return NextResponse.json({ message: 'done', result })
}
