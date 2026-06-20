import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone, sendWhatsAppMessage } from '@/lib/whatsapp'
import { processInboundReceipt } from '@/lib/payment-receipt'
import { createLogger } from '@/lib/logger'

const log = createLogger('webhook/waha')

const WAHA_URL = process.env.WAHA_API_URL
const WAHA_KEY = process.env.WAHA_API_KEY

// Customer typed a payment claim directly (no attachment) — e.g. pasted a
// bank confirmation text. Requires a payment keyword AND a number to avoid
// matching casual chat like "بدفع لك بكرة".
const PAYMENT_TEXT_RE = /سددت|دفعت|حولت|ايصال|إيصال|paid|receipt|transfer/i
function looksLikeTextReceipt(text: string): boolean {
  return PAYMENT_TEXT_RE.test(text) && /\d{2,}/.test(text)
}

async function downloadMediaBase64(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { 'X-Api-Key': WAHA_KEY ?? '' } })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.toString('base64')
  } catch {
    return null
  }
}

// WAHA addresses LID-migrated contacts by "<id>@lid". Resolve it to the real
// phone number so we can match the customer (stored by phone in our DB).
async function resolvePhone(from: string, session: string): Promise<string> {
  const [user, server] = from.split('@')
  if (server !== 'lid') return normalizePhone(user)
  try {
    const r = await fetch(`${WAHA_URL!.replace(/\/$/, '')}/api/${session}/lids/${user}`, {
      headers: { 'X-Api-Key': WAHA_KEY ?? '' },
    })
    const j = await r.json().catch(() => ({} as any))
    const pn = String(j?.pn ?? '').split('@')[0]
    return pn ? normalizePhone(pn) : ''
  } catch {
    return ''
  }
}

const ackToStatus: Record<number, string> = { 1: 'sent', 2: 'delivered', 3: 'read', 4: 'read' }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any))
    const event: string = body?.event ?? ''
    const session: string = body?.session ?? process.env.WAHA_SESSION ?? 'default'
    const payload = body?.payload ?? {}

    const supabase = createServiceClient()

    // ── Delivery acknowledgements ──
    if (event === 'message.ack') {
      const msgId = String(payload?.id?._serialized ?? payload?.id ?? '')
      const newStatus = ackToStatus[Number(payload?.ack)]
      if (msgId && newStatus) {
        const id = msgId.split('_').pop() ?? msgId
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 }
        const { data: row } = await supabase
          .from('messages').select('status').eq('whatsapp_message_id', id).maybeSingle()
        if (!row || (rank[newStatus] ?? 0) > (rank[(row as { status: string }).status] ?? 0)) {
          await supabase.from('messages').update({ status: newStatus }).eq('whatsapp_message_id', id)
        }
      }
      return NextResponse.json({ status: 'ok' })
    }

    // ── Inbound messages ──
    if (event !== 'message' && event !== 'message.any') return NextResponse.json({ status: 'ok' })
    if (payload?.fromMe) return NextResponse.json({ status: 'ok' })

    const from = String(payload?.from ?? '')
    const text = String(payload?.body ?? '')
    const mediaUrl: string = payload?.media?.url ?? ''
    const mimetype: string = String(payload?.media?.mimetype ?? '')
    const hasReceiptMedia = !!mediaUrl && (mimetype.startsWith('image/') || mimetype === 'application/pdf')
    if (from.endsWith('@g.us')) { log.info('group message ignored', { from }); return NextResponse.json({ status: 'ok' }) }
    // Accept the message if it has text OR a receipt-type attachment.
    if (!from || (!text && !hasReceiptMedia)) return NextResponse.json({ status: 'ok' })

    const phone = await resolvePhone(from, session)
    if (!phone) { log.warn('could not resolve phone', { from }); return NextResponse.json({ status: 'ok' }) }

    log.info('WAHA inbound', { from, phone, hasReceiptMedia, mimetype })

    const { data: customer } = await supabase
      .from('customers')
      .select('id, company_id, full_name, ai_paused')
      .or([`whatsapp.eq.${phone}`, `whatsapp.eq.+${phone}`, `phone.eq.${phone}`, `phone.eq.+${phone}`].join(','))
      .limit(1).maybeSingle()

    if (!customer) { log.warn('no customer for inbound', { phone }); return NextResponse.json({ status: 'ok' }) }

    const c = customer as { id: string; company_id: string; full_name?: string; ai_paused?: boolean }
    const msgId = String(payload?.id?._serialized ?? payload?.id ?? '').split('_').pop() ?? null

    // Idempotency guard: WAHA/WhatsApp can redeliver the same webhook event
    // (network retry, duplicate push) — without this check, the agent would
    // run and reply twice for the exact same inbound message.
    if (msgId) {
      const { data: dup } = await supabase
        .from('messages').select('id').eq('whatsapp_message_id', msgId).eq('direction', 'inbound')
        .limit(1).maybeSingle()
      if (dup) { log.info('duplicate inbound webhook ignored', { msgId }); return NextResponse.json({ status: 'ok' }) }
    }

    const { data: latestDebt } = await supabase
      .from('debts').select('id, current_balance').eq('customer_id', c.id)
      .not('status', 'in', '("settled","written_off")')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const debt_id = (latestDebt as { id: string } | null)?.id ?? null

    await supabase.from('messages').insert({
      company_id: c.company_id, customer_id: c.id, debt_id,
      channel: 'whatsapp', direction: 'inbound',
      content: text || (mimetype === 'application/pdf' ? '📎 إيصال (PDF)' : '📎 إيصال (صورة)'),
      status: 'delivered',
      whatsapp_message_id: msgId,
      metadata: { provider: 'waha', from, ...(hasReceiptMedia && { media_url: mediaUrl, mimetype }) },
      sent_at: new Date().toISOString(),
    })

    if (c.ai_paused) { log.info('AI paused — skipping reply', { customer_id: c.id }); return NextResponse.json({ status: 'ok' }) }

    // Payment receipt (image / PDF) → OCR verification pipeline.
    if (hasReceiptMedia) {
      ;(async () => {
        try {
          const r = await fetch(mediaUrl, { headers: { 'X-Api-Key': WAHA_KEY ?? '' } })
          if (!r.ok) { log.error('receipt media download failed', undefined, { status: r.status }); return }
          const b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
          const { processInboundReceipt } = await import('@/lib/payment-receipt')
          await processInboundReceipt({
            company_id: c.company_id, customer_id: c.id, customer_name: c.full_name,
            debt_id, phone, source: mimetype === 'application/pdf' ? 'pdf' : 'image', data: b64,
          })
        } catch (err) {
          log.error('WAHA receipt processing error', err as Error)
        }
      })().catch(() => {})
      return NextResponse.json({ status: 'ok' })
    }

    // Run the collector agent and reply (sendWhatsAppMessage routes via WAHA)
    ;(async () => {
      const { runCollectorAgent } = await import('@/lib/ai-collector-agent')
      const { processEvent } = await import('@/lib/automation-pipeline')

      const aiDecision = await runCollectorAgent({
        company_id: c.company_id, customer_id: c.id, debt_id, message: text,
      })

      if (aiDecision.shouldReply && aiDecision.message) {
        const waResult = await sendWhatsAppMessage({ to: phone, message: aiDecision.message, company_id: c.company_id })
        await supabase.from('messages').insert({
          company_id: c.company_id, customer_id: c.id, debt_id,
          channel: 'whatsapp', direction: 'outbound', content: aiDecision.message,
          status: waResult.status === 'sent' ? 'sent' : 'failed',
          whatsapp_message_id: waResult.message_id || null,
          metadata: { sender: 'ai', action_type: aiDecision.action, provider: 'waha', error: waResult.error },
          sent_at: new Date().toISOString(),
        })
        if (waResult.status === 'sent') {
          await processEvent({
            debt_id: debt_id ?? 'temp', company_id: c.company_id,
            source: 'ai_reply', event_type: 'whatsapp_outbound',
            data: { message: aiDecision.message, action: aiDecision.action },
          }).catch(e => log.error('pipeline failed', e as Error))
        }
      }

      // Dispute → open dispute + approval (dedup), with full context
      if (aiDecision.action === 'record_dispute' && debt_id) {
        const { recordDispute } = await import('@/lib/dispute')
        await recordDispute({
          company_id: c.company_id, customer_id: c.id, customer_name: c.full_name,
          debt_id, customer_message: text, agent_reason: aiDecision.reason,
        })
      }

      // Promise → record ONLY with the date the agent extracted from the
      // customer's own current message (never fabricated).
      if (aiDecision.action === 'record_promise' && debt_id && aiDecision.promised_date) {
        const { recordPromise } = await import('@/lib/promise')
        await recordPromise({
          company_id: c.company_id, customer_id: c.id, debt_id,
          promised_amount: Number((latestDebt as { current_balance?: number } | null)?.current_balance ?? 0),
          promised_date: aiDecision.promised_date, customer_message: text,
        })
      }
    })().catch(err => log.error('WAHA AI processing error', err as Error))

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    log.error('WAHA webhook error', err as Error)
    return NextResponse.json({ status: 'ok' })
  }
}
