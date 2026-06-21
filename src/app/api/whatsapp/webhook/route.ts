import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseWebhookPayload, normalizePhone, sendWhatsAppMessage, type WhatsAppWebhookEntry } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'
import { processEvent } from '@/lib/automation-pipeline'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { createHash } from 'crypto'

const log = createLogger('webhook/whatsapp')

function verifySignature(body: string, signature: string | null): boolean {
  const appSecret = process.env.APP_SECRET
  if (!appSecret) {
    log.warn('APP_SECRET not set Ã¢â‚¬â€ skipping signature verification')
    return true
  }
  if (!signature) return false

  const expected = 'sha256=' + createHash('sha256').update(appSecret).update(body).digest('hex')
  if (expected.length !== signature.length) return false

  let mismatch = 0
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return mismatch === 0
}

export async function GET(request: NextRequest) {
  const params    = request.nextUrl.searchParams
  const mode      = params.get('hub.mode')
  const token     = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    log.info('Webhook verified by Meta')
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  log.warn('Webhook verification failed Ã¢â‚¬â€ token mismatch')
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  // Always return 200 Ã¢â‚¬â€ Meta retries on non-200 responses
  try {
    const rawBody   = await request.text()
    const signature = request.headers.get('x-hub-signature-256')

    const evo = JSON.parse(rawBody)

    if (!evo?.event && process.env.NODE_ENV === 'production' && !verifySignature(rawBody, signature)) {
      log.error('Webhook signature verification failed')
      return NextResponse.json({ status: 'ok' })
    }

    if (evo?.event && evo?.instance) {
      const supabase = createServiceClient()

      const { error: evoError } = await supabase.from('webhook_events').insert({
        provider: 'evolution',
        event_id: `${evo.instance}:${evo.event}:${Date.now()}`,
        event_type: evo.event,
        payload: evo,
      })

      if (evoError) {
        return NextResponse.json({
          status: 'error',
          step: 'evolution_insert_failed',
          message: evoError.message,
          code: evoError.code,
        }, { status: 500 })
      }

      log.info('Evolution webhook received', {
        event: evo.event,
        instance: evo.instance,
      })

      // ── Delivery acknowledgements: track whether our outbound messages
      // actually reached the recipient. Lets us detect a "silent block" where
      // WhatsApp accepts messages but never delivers them.
      if (evo.event === 'messages.update' || evo.event === 'messages.ack') {
        const updates = Array.isArray(evo.data) ? evo.data : [evo.data]
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 }
        const mapStatus = (s: string): string | null => {
          const v = String(s || '').toUpperCase()
          if (v === 'SERVER_ACK' || v === 'PENDING') return 'sent'
          if (v === 'DELIVERY_ACK') return 'delivered'
          if (v === 'READ' || v === 'PLAYED') return 'read'
          return null
        }
        for (const u of updates) {
          const msgId = u?.keyId ?? u?.key?.id ?? u?.messageId
          const newStatus = mapStatus(u?.status ?? u?.update?.status)
          if (!msgId || !newStatus) continue
          const { data: row } = await supabase
            .from('messages').select('status').eq('whatsapp_message_id', String(msgId)).maybeSingle()
          // only upgrade status (don't overwrite read with sent)
          if (row && (rank[newStatus] ?? 0) <= (rank[(row as { status: string }).status] ?? 0)) continue
          await supabase.from('messages').update({ status: newStatus }).eq('whatsapp_message_id', String(msgId))
        }
        return NextResponse.json({ status: 'ok' })
      }

      if (evo.event === 'messages.upsert' && evo.data?.key?.fromMe === false) {
        const remoteJid = String(evo.data.key.remoteJid ?? '')
        const phoneRaw = normalizePhone(remoteJid.split('@')[0] ?? '')
        const text =
          evo.data.message?.conversation ??
          evo.data.message?.extendedTextMessage?.text ??
          ''

        if (phoneRaw && text) {
          const { data: customer } = await supabase
            .from('customers')
            .select('id, company_id, full_name, ai_paused')
            .or([
              `whatsapp.eq.${phoneRaw}`,
              `whatsapp.eq.+${phoneRaw}`,
              `phone.eq.${phoneRaw}`,
              `phone.eq.+${phoneRaw}`,
            ].join(','))
            .limit(1)
            .maybeSingle()

          if (customer) {
            // Idempotency guard: avoid replying twice to a redelivered webhook.
            const inboundMsgId = String(evo.data.key.id ?? '')
            if (inboundMsgId) {
              const { data: dup } = await supabase
                .from('messages').select('id').eq('whatsapp_message_id', inboundMsgId).eq('direction', 'inbound')
                .limit(1).maybeSingle()
              if (dup) { log.info('duplicate inbound webhook ignored', { msgId: inboundMsgId }); return NextResponse.json({ status: 'ok' }) }
            }

            const { data: latestDebt } = await supabase
              .from('debts')
              .select('id, current_balance')
              .eq('customer_id', (customer as { id: string }).id)
              .not('status', 'in', '("settled","written_off")')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()

            await supabase.from('messages').insert({
              company_id: (customer as { company_id: string }).company_id,
              customer_id: (customer as { id: string }).id,
              debt_id: (latestDebt as { id: string } | null)?.id ?? null,
              channel: 'whatsapp',
              direction: 'inbound',
              content: text,
              status: 'delivered',
              whatsapp_message_id: String(evo.data.key.id ?? ''),
              sent_at: new Date(Number(evo.data.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString(),
              metadata: { provider: 'evolution', from: phoneRaw, remoteJid },
            })

            await supabase.from('collection_followups').upsert({
              company_id: (customer as { company_id: string }).company_id,
              customer_id: (customer as { id: string }).id,
              debt_id: (latestDebt as { id: string } | null)?.id ?? null,
              source_system: 'whatsapp_evolution',
              external_followup_id: String(evo.data.key.id ?? ''),
              followup_type: 'customer_message',
              followup_channel: 'whatsapp',
              customer_statement: text,
              result_summary: 'Inbound WhatsApp message received',
              occurred_at: new Date(Number(evo.data.messageTimestamp ?? Date.now() / 1000) * 1000).toISOString(),
              raw_payload: { provider: 'evolution', from: phoneRaw, remoteJid, message_id: String(evo.data.key.id ?? ''), message: text },
            }, { onConflict: 'company_id,source_system,external_followup_id' })


            processEvent({
              source: 'webhook_evolution',
              company_id: (customer as { company_id: string }).company_id,
              _customer_id: (customer as { id: string }).id,
              _debt_id: (latestDebt as { id: string } | null)?.id,
              data: { message: text, from: phoneRaw, message_id: String(evo.data.key.id ?? '') },
            }).catch(() => {})

            // Process AI decision natively instead of n8n — unless AI is paused
            // (customer handed off to a human agent).
            ;(async () => {
              if ((customer as { ai_paused?: boolean }).ai_paused) {
                log.info('AI paused for customer — skipping auto-reply', { customer_id: (customer as { id: string }).id })
                return
              }
              const { runCollectorAgent } = await import('@/lib/ai-collector-agent')
              const { sendWhatsAppMessage } = await import('@/lib/whatsapp')
              const { processEvent } = await import('@/lib/automation-pipeline')

              const company_id = (customer as { company_id: string }).company_id
              const customer_id = (customer as { id: string }).id
              const debt_id = (latestDebt as { id: string } | null)?.id ?? undefined

              // The agent reviews the full case file + conversation history from
              // the DB internally, so no need to pre-build context here.
              const aiDecision = await runCollectorAgent({
                company_id,
                customer_id,
                debt_id: debt_id ?? null,
                message: text,
              })

              if (aiDecision.shouldReply && aiDecision.message) {
                const waResult = await sendWhatsAppMessage({
                  to: phoneRaw,
                  message: aiDecision.message,
                  company_id,
                })

                await createServiceClient().from('messages').insert({
                  company_id,
                  customer_id,
                  debt_id: debt_id ?? null,
                  channel: 'whatsapp',
                  direction: 'outbound',
                  content: aiDecision.message,
                  status: waResult.status === 'sent' ? 'sent' : 'failed',
                  whatsapp_message_id: waResult.message_id || null,
                  metadata: { sender: 'ai', action_type: aiDecision.action, instance_name: evo.instance, error: waResult.error },
                  sent_at: new Date().toISOString(),
                })

                if (waResult.status === 'sent') {
                  await processEvent({
                    debt_id: debt_id ?? 'temp',
                    company_id,
                    source: 'ai_reply',
                    data: { message: aiDecision.message, action: aiDecision.action }
                  }).catch(e => log.error('pipeline processing failed', e))
                }
              }

              // Customer raised a dispute → open a dispute + an admin approval (dedup), with full context
              if (aiDecision.action === 'record_dispute' && debt_id) {
                const { recordDispute } = await import('@/lib/dispute')
                await recordDispute({
                  company_id, customer_id, customer_name: (customer as { full_name?: string }).full_name,
                  debt_id, customer_message: text, agent_reason: aiDecision.reason,
                })
              }

              // Promise → record ONLY with the date the agent extracted from
              // the customer's own current message (never fabricated).
              if (aiDecision.action === 'record_promise' && debt_id && aiDecision.promised_date) {
                const { recordPromise } = await import('@/lib/promise')
                await recordPromise({
                  company_id, customer_id, debt_id,
                  promised_amount: Number((latestDebt as { current_balance?: number } | null)?.current_balance ?? 0),
                  promised_date: aiDecision.promised_date, customer_message: text,
                })
              }
            })().catch(err => log.error('AI Processing Error', err))
          }
        }

        // ── Image messages = payment receipts → OCR verification ──
        const imageMsg = evo.data.message?.imageMessage
        if (phoneRaw && imageMsg && !text) {
          ;(async () => {
            const svc = createServiceClient()
            const { data: customer } = await svc.from('customers')
              .select('id, company_id, full_name')
              .or([`whatsapp.eq.${phoneRaw}`, `whatsapp.eq.+${phoneRaw}`, `phone.eq.${phoneRaw}`, `phone.eq.+${phoneRaw}`].join(','))
              .limit(1).maybeSingle()
            if (!customer) return
            const company_id = (customer as any).company_id
            const customer_id = (customer as any).id
            const { data: latestDebt } = await svc.from('debts')
              .select('id, current_balance, currency')
              .eq('customer_id', customer_id).not('status', 'in', '("settled","written_off")')
              .order('created_at', { ascending: false }).limit(1).maybeSingle()
            const debt_id = (latestDebt as any)?.id ?? null

            await svc.from('messages').insert({
              company_id, customer_id, debt_id, channel: 'whatsapp', direction: 'inbound',
              content: '📎 إيصال دفع (صورة)', status: 'delivered',
              whatsapp_message_id: String(evo.data.key.id ?? ''), sent_at: new Date().toISOString(),
              metadata: { provider: 'evolution', from: phoneRaw, type: 'image' },
            })

            const { getMediaBase64, sendWhatsAppMessage } = await import('@/lib/whatsapp')
            const { extractReceipt } = await import('@/lib/receipt-ocr')
            const b64 = await getMediaBase64({ messageKey: evo.data.key, company_id })
            if (!b64) return
            const ocr = await extractReceipt(b64)
            if (!ocr || !ocr.is_receipt || !ocr.amount) return  // not a receipt → leave for human/agent

            const balance = Number((latestDebt as any)?.current_balance ?? 0)
            const currency = (latestDebt as any)?.currency ?? 'SAR'
            const autoVerify = ocr.confidence >= 70 && ocr.amount > 0 && ocr.amount <= balance * 1.2 + 1

            await svc.from('payments').insert({
              company_id, customer_id, debt_id, amount: ocr.amount, currency,
              status: autoVerify ? 'completed' : 'pending',
              payment_date: (ocr.date && /^\d{4}-\d{2}-\d{2}$/.test(ocr.date)) ? ocr.date : new Date().toISOString().slice(0, 10),
              verification_status: autoVerify ? 'verified' : 'pending',
              ocr_data: ocr, notes: 'إيصال عبر الواتساب (قراءة آلية)',
            })

            let reply: string
            if (autoVerify && debt_id) {
              const newBal = Math.max(0, balance - ocr.amount)
              const upd: Record<string, unknown> = { current_balance: newBal }
              if (newBal <= 0) upd.status = 'settled'
              await svc.from('debts').update(upd).eq('id', debt_id)
              reply = `تم استلام إيصالك وتأكيد مبلغ ${ocr.amount} ${currency}. ${newBal <= 0 ? 'تم سداد المديونية بالكامل، شكراً لك.' : `المتبقي ${newBal} ${currency}.`}`
            } else {
              reply = 'استلمنا إيصالك، جاري التحقق منه وسنؤكد لك قريباً. شكراً.'
              await svc.from('system_alerts').insert({
                company_id, severity: 'info', alert_type: 'payment_review',
                title: 'إيصال دفع يحتاج مراجعة',
                message: `العميل ${(customer as any).full_name} أرسل إيصالاً بمبلغ ${ocr.amount ?? '؟'} ${currency} (ثقة ${ocr.confidence}%)`,
                metadata: { debt_id, customer_id }, is_resolved: false,
              })
            }
            const wr = await sendWhatsAppMessage({ to: phoneRaw, message: reply, company_id })
            await svc.from('messages').insert({
              company_id, customer_id, debt_id, channel: 'whatsapp', direction: 'outbound',
              content: reply, status: wr.status === 'sent' ? 'sent' : 'failed',
              whatsapp_message_id: wr.message_id || null,
              metadata: { sender: 'ai', action_type: 'reply', source: 'receipt_verification' },
              sent_at: new Date().toISOString(),
            })
          })().catch(err => log.error('receipt processing error', err))
        }
      }

      return NextResponse.json({ status: 'ok' })
    }
    let body: { object: string; entry: WhatsAppWebhookEntry[] }
    try {
      body = JSON.parse(rawBody)
    } catch {
      log.error('Invalid webhook JSON payload')
      return NextResponse.json({ status: 'ok' })
    }

    if (body.object !== 'whatsapp_business_account') {
      return NextResponse.json({ status: 'ok' })
    }

    const { messages, statuses } = parseWebhookPayload(body)
    const supabase = createServiceClient()

    // Process inbound messages
    for (const msg of messages) {
      try {
        // Idempotency Ã¢â‚¬â€ skip if already processed
        const { error: dupErr } = await supabase
          .from('webhook_events')
          .insert({ provider: 'whatsapp', event_id: msg.id, event_type: 'message', payload: msg as unknown as Record<string, unknown> })

        if (dupErr?.code === '23505') {
          log.info('Duplicate webhook message skipped', { message_id: msg.id })
          continue
        }

        const phoneRaw = normalizePhone(msg.from)

        const { data: customer } = await supabase
          .from('customers')
          .select('id, company_id, full_name')
          .or([
            `whatsapp.eq.${phoneRaw}`,
            `whatsapp.eq.+${phoneRaw}`,
            `phone.eq.${phoneRaw}`,
            `phone.eq.+${phoneRaw}`,
          ].join(','))
          .limit(1)
          .maybeSingle()

        if (!customer) {
          log.info('WhatsApp message from unknown sender', { phone: phoneRaw })
          continue
        }

        const { data: latestDebt } = await supabase
          .from('debts')
          .select('id')
          .eq('customer_id', (customer as { id: string }).id)
          .not('status', 'in', '("settled","written_off")')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        await supabase.from('messages').insert({
          company_id:          (customer as { company_id: string }).company_id,
          customer_id:         (customer as { id: string }).id,
          debt_id:             (latestDebt as { id: string } | null)?.id ?? null,
          channel:             'whatsapp',
          direction:           'inbound',
          content:             msg.text,
          status:              'delivered',
          whatsapp_message_id: msg.id,
          sent_at:             new Date(parseInt(msg.timestamp, 10) * 1000).toISOString(),
          metadata:            { from: phoneRaw, type: msg.type },
        })

        log.info('Inbound WhatsApp message saved', {
          customer_id: (customer as { id: string }).id,
          message_id:  msg.id,
        })

        // Trigger automation pipeline for inbound message
        processEvent({
          source:       'webhook_whatsapp',
          company_id:   (customer as { company_id: string }).company_id,
          _customer_id: (customer as { id: string }).id,
          _debt_id:     (latestDebt as { id: string } | null)?.id,
          data: { message: msg.text, from: msg.from, message_id: msg.id },
        }).catch(() => {})
      } catch (msgErr) {
        log.error('Error processing inbound message', msgErr, { message_id: msg.id })
      }
    }

    // Process delivery status updates
    for (const status of statuses) {
      try {
        const { error: dupErr } = await supabase
          .from('webhook_events')
          .insert({
            provider:   'whatsapp',
            event_id:   `${status.message_id}:${status.status}`,
            event_type: 'status',
            payload:    status as unknown as Record<string, unknown>,
          })

        if (dupErr?.code === '23505') continue

        await supabase
          .from('messages')
          .update({
            status:          status.status as 'sent' | 'delivered' | 'read' | 'failed',
            whatsapp_status: status.status,
          })
          .eq('whatsapp_message_id', status.message_id)
      } catch (statusErr) {
        log.error('Error processing status update', statusErr, { message_id: status.message_id })
      }
    }

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    log.error('Unhandled webhook error', err)
    return NextResponse.json({ status: 'ok' })
  }
}










