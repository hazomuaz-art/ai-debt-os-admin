import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/rasf/webhook')

function pick(payload: any, paths: string[]) {
  for (const path of paths) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], payload)
    if (value !== undefined && value !== null && String(value).trim() !== '') return value
  }
  return null
}

function normalizePhone(phone: string) {
  return String(phone).replace(/[^\d]/g, '')
}

export async function POST(req: NextRequest) {
  const supabase = createServiceClient()

  // Unauthenticated previously — anyone who found this URL could inject
  // arbitrary customer/timeline data using the full service-role client.
  // Enforced once RASF_WEBHOOK_SECRET is configured on both sides; logged
  // loudly if still unset so the gap stays visible rather than silent.
  const expectedSecret = process.env.RASF_WEBHOOK_SECRET
  if (expectedSecret) {
    const provided = req.headers.get('x-webhook-secret') ?? req.nextUrl.searchParams.get('secret')
    if (provided !== expectedSecret) {
      log.warn('Rasf webhook rejected — missing/invalid secret')
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  } else {
    log.error('RASF_WEBHOOK_SECRET is not set — this endpoint is unauthenticated and publicly writable')
  }

  let payload: any
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const eventId =
    pick(payload, ['message_id', 'id', 'message.id', 'data.id', 'data.message_id']) ||
    `rasf-${Date.now()}`

  const phoneRaw = pick(payload, [
    'from',
    'phone',
    'mobile',
    'customer_phone',
    'sender',
    'contact.phone',
    'message.from',
    'data.from',
    'data.phone',
    'data.customer_phone',
    'data.sender'
  ])

  const text = pick(payload, [
    'text',
    'message',
    'body',
    'content',
    'message.text',
    'message.body',
    'data.text',
    'data.message',
    'data.body',
    'data.content'
  ])

  await supabase.from('webhook_events').insert({
    provider: 'rasf',
    event_id: String(eventId),
    event_type: 'message',
    payload
  }).then(() => null)

  if (!phoneRaw || !text) {
    log.warn('Rasf webhook missing phone or text', { eventId })
    return NextResponse.json({
      ok: true,
      received: true,
      processed: false,
      reason: 'missing phone or text'
    })
  }

  const phone = normalizePhone(String(phoneRaw))

  const { data: customer } = await supabase
    .from('customers')
    .select('id, company_id, full_name')
    .or([
      `whatsapp.eq.${phone}`,
      `whatsapp.eq.+${phone}`,
      `phone.eq.${phone}`,
      `phone.eq.+${phone}`
    ].join(','))
    .limit(1)
    .maybeSingle()

  if (!customer) {
    log.info('Rasf message from unknown sender', { phone })
    return NextResponse.json({
      ok: true,
      received: true,
      processed: false,
      reason: 'customer not found',
      phone
    })
  }

  const { data: latestDebt } = await supabase
    .from('debts')
    .select('id')
    .eq('customer_id', customer.id)
    .not('status', 'in', '("settled","written_off")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: savedMessage, error } = await supabase
    .from('messages')
    .insert({
      company_id: customer.company_id,
      customer_id: customer.id,
      debt_id: latestDebt?.id ?? null,
      channel: 'whatsapp',
      direction: 'inbound',
      content: String(text),
      status: 'delivered',
      whatsapp_message_id: String(eventId),
      sent_at: new Date().toISOString(),
      metadata: {
        provider: 'rasf',
        phone,
        raw: payload
      }
    })
    .select()
    .single()

  if (error) {
    log.error('Failed to save Rasf inbound message', error)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  await supabase.from('timeline_events').insert({
    company_id: customer.company_id,
    customer_id: customer.id,
    debt_id: latestDebt?.id ?? null,
    event_type: 'whatsapp_inbound',
    title: 'Rasf WhatsApp inbound message',
    description: String(text),
    occurred_at: new Date().toISOString(),
    metadata: { provider: 'rasf', message_id: eventId, phone }
  }).then(() => null)

  return NextResponse.json({
    ok: true,
    received: true,
    processed: true,
    customer_id: customer.id,
    message_id: savedMessage?.id ?? null
  })
}
