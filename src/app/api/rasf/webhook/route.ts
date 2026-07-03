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

  // Real gap found during a full-system security audit: when
  // RASF_WEBHOOK_SECRET was unset, this fell through to processing the
  // request anyway (only logging an error) — meaning the route was live and
  // fully open to the public internet, able to inject arbitrary
  // customer/timeline data via the full service-role client. Confirmed live
  // in production: the env var was never set, so this was genuinely
  // exploitable, not theoretical. Fail CLOSED (503, service disabled) when
  // unconfigured, never fail open — same fix as email/inbound-webhook.
  const expectedSecret = process.env.RASF_WEBHOOK_SECRET
  if (!expectedSecret) {
    log.error('RASF_WEBHOOK_SECRET is not set — rasf webhook is disabled until configured')
    return NextResponse.json({ ok: false, error: 'Service not configured' }, { status: 503 })
  }
  const provided = req.headers.get('x-webhook-secret') ?? req.nextUrl.searchParams.get('secret')
  if (provided !== expectedSecret) {
    log.warn('Rasf webhook rejected — missing/invalid secret')
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
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

  const { error: webhookLogErr } = await supabase.from('webhook_events').insert({
    provider: 'rasf',
    event_id: String(eventId),
    event_type: 'message',
    payload
  })
  if (webhookLogErr) log.error('rasf webhook_events insert failed', webhookLogErr, { event_id: eventId })

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

  // This insert was doubly broken: 'whatsapp_inbound' is not a valid
  // timeline_events.event_type (the real value is 'whatsapp_in'), AND
  // title/description aren't real columns on this table (they're
  // summary/detail) — every Rasf inbound message has silently failed to
  // log to the timeline since this route shipped. `.then(() => null)`
  // discarded the result either way, so this was never visible.
  const { error: teErr } = await supabase.from('timeline_events').insert({
    company_id: customer.company_id,
    customer_id: customer.id,
    debt_id: latestDebt?.id ?? null,
    event_type: 'whatsapp_in',
    channel: 'whatsapp',
    actor_type: 'customer',
    summary: 'رسالة واردة عبر Rasf',
    detail: String(text),
    occurred_at: new Date().toISOString(),
    metadata: { provider: 'rasf', message_id: eventId, phone }
  })
  if (teErr) log.error('Rasf timeline_events insert failed', new Error(teErr.message))

  return NextResponse.json({
    ok: true,
    received: true,
    processed: true,
    customer_id: customer.id,
    message_id: savedMessage?.id ?? null
  })
}
