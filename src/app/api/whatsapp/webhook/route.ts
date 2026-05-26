import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parseWebhookPayload, normalizePhone, type WhatsAppWebhookEntry } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'
import { createHash } from 'crypto'

const log = createLogger('webhook/whatsapp')

function verifySignature(body: string, signature: string | null): boolean {
  const appSecret = process.env.APP_SECRET
  if (!appSecret) {
    log.warn('APP_SECRET not set — skipping signature verification')
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

  log.warn('Webhook verification failed — token mismatch')
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

export async function POST(request: NextRequest) {
  // Always return 200 — Meta retries on non-200 responses
  try {
    const rawBody   = await request.text()
    const signature = request.headers.get('x-hub-signature-256')

    if (process.env.NODE_ENV === 'production' && !verifySignature(rawBody, signature)) {
      log.error('Webhook signature verification failed')
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
        // Idempotency — skip if already processed
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
