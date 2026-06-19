import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone, sendWhatsAppMessage } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'

const log = createLogger('webhook/waha')

const WAHA_URL = process.env.WAHA_API_URL
const WAHA_KEY = process.env.WAHA_API_KEY

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
    if (from.endsWith('@g.us')) { log.info('group message ignored', { from }); return NextResponse.json({ status: 'ok' }) }
    if (!from || !text) return NextResponse.json({ status: 'ok' })

    const phone = await resolvePhone(from, session)
    if (!phone) { log.warn('could not resolve phone', { from }); return NextResponse.json({ status: 'ok' }) }

    log.info('WAHA inbound', { from, phone })

    const { data: customer } = await supabase
      .from('customers')
      .select('id, company_id, full_name, ai_paused')
      .or([`whatsapp.eq.${phone}`, `whatsapp.eq.+${phone}`, `phone.eq.${phone}`, `phone.eq.+${phone}`].join(','))
      .limit(1).maybeSingle()

    if (!customer) { log.warn('no customer for inbound', { phone }); return NextResponse.json({ status: 'ok' }) }

    const c = customer as { id: string; company_id: string; full_name?: string; ai_paused?: boolean }
    const msgId = String(payload?.id?._serialized ?? payload?.id ?? '').split('_').pop() ?? null

    const { data: latestDebt } = await supabase
      .from('debts').select('id').eq('customer_id', c.id)
      .not('status', 'in', '("settled","written_off")')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const debt_id = (latestDebt as { id: string } | null)?.id ?? null

    await supabase.from('messages').insert({
      company_id: c.company_id, customer_id: c.id, debt_id,
      channel: 'whatsapp', direction: 'inbound', content: text, status: 'delivered',
      whatsapp_message_id: msgId,
      metadata: { provider: 'waha', from },
      sent_at: new Date().toISOString(),
    })

    if (c.ai_paused) { log.info('AI paused — skipping reply', { customer_id: c.id }); return NextResponse.json({ status: 'ok' }) }

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

      // Dispute → open dispute + approval (dedup)
      if (aiDecision.action === 'record_dispute' && debt_id) {
        const { data: existing } = await supabase.from('approvals')
          .select('id').eq('company_id', c.company_id).eq('entity_id', debt_id)
          .eq('approval_type', 'dispute').eq('status', 'pending').limit(1).maybeSingle()
        if (!existing) {
          const { data: disp } = await supabase.from('disputes').insert({
            company_id: c.company_id, customer_id: c.id, debt_id,
            dispute_type: 'customer_claim', description: text, status: 'pending',
            priority: 'high', source: 'whatsapp_ai',
          }).select('id').single()
          await supabase.from('approvals').insert({
            company_id: c.company_id, approval_type: 'dispute', entity_type: 'debt', entity_id: debt_id,
            title: `اعتراض عميل: ${c.full_name ?? ''}`, description: `سبب العميل: ${text}`,
            status: 'pending', priority: 'high',
            requested_data: { customer_id: c.id, dispute_id: disp?.id ?? null, reason: text },
          })
        }
      }
    })().catch(err => log.error('WAHA AI processing error', err as Error))

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    log.error('WAHA webhook error', err as Error)
    return NextResponse.json({ status: 'ok' })
  }
}
