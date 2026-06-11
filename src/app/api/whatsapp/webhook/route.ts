import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseWebhookPayload, normalizePhone, sendWhatsAppMessage, type WhatsAppWebhookEntry } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'
import { processEvent } from '@/lib/automation-pipeline'
import { generateWhatsappAutoReply } from '@/lib/ai-whatsapp-reply'
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
            .select('id, company_id, full_name')
            .or([
              `whatsapp.eq.${phoneRaw}`,
              `whatsapp.eq.+${phoneRaw}`,
              `phone.eq.${phoneRaw}`,
              `phone.eq.+${phoneRaw}`,
            ].join(','))
            .limit(1)
            .maybeSingle()

          if (customer) {
            const { data: latestDebt } = await supabase
              .from('debts')
              .select('id')
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


            const pipelineResult = await processEvent({
              source: 'webhook_evolution',
              company_id: (customer as { company_id: string }).company_id,
              _customer_id: (customer as { id: string }).id,
              _debt_id: (latestDebt as { id: string } | null)?.id,
              data: { message: text, from: phoneRaw, message_id: String(evo.data.key.id ?? '') },
            })

            await supabase.from('webhook_events').insert({
              provider: 'ai_debt_os',
              event_id: `pipeline:${evo.data.key.id ?? Date.now()}`,
              event_type: 'pipeline_result',
              payload: pipelineResult as unknown as Record<string, unknown>,
            }).catch(() => {})

            const autoReply = await generateWhatsappAutoReply({
              company_id: (customer as { company_id: string }).company_id,
              customer_id: (customer as { id: string }).id,
              debt_id: (latestDebt as { id: string } | null)?.id ?? null,
              message: text,
            })

            const sendResult = await sendWhatsAppMessage({ to: phoneRaw, message: autoReply })

            await supabase.from('messages').insert({
              company_id: (customer as { company_id: string }).company_id,
              customer_id: (customer as { id: string }).id,
              debt_id: (latestDebt as { id: string } | null)?.id ?? null,
              channel: 'whatsapp',
              direction: 'outbound',
              content: autoReply,
              status: sendResult.status === 'sent' ? 'sent' : 'failed',
              whatsapp_message_id: sendResult.message_id ?? null,
              sent_at: new Date().toISOString(),
              metadata: { provider: 'evolution_ai_auto_reply', error: sendResult.error ?? null },
            })
          }
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
            const pipelineResult = await processEvent({
          source:       'webhook_whatsapp',
          company_id:   (customer as { company_id: string }).company_id,
          _customer_id: (customer as { id: string }).id,
          _debt_id:     (latestDebt as { id: string } | null)?.id,
          data: { message: msg.text, from: msg.from, message_id: msg.id },
            })

            await supabase.from('webhook_events').insert({
              provider: 'ai_debt_os',
              event_id: `pipeline:${evo.data.key.id ?? Date.now()}`,
              event_type: 'pipeline_result',
              payload: pipelineResult as unknown as Record<string, unknown>,
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











