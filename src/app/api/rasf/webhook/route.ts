import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import { normalizePhone } from '@/lib/whatsapp'
import { resolveCompanyFromEnvMap } from '@/lib/tenant-map'

const log = createLogger('api/rasf/webhook')

function pick(payload: Record<string, unknown>, paths: readonly string[]): unknown {
  for (const path of paths) {
    let value: unknown = payload
    for (const key of path.split('.')) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        value = undefined
        break
      }
      value = (value as Record<string, unknown>)[key]
    }
    if (value !== undefined && value !== null && String(value).trim()) return value
  }
  return null
}

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.RASF_WEBHOOK_SECRET
  if (!expectedSecret || !process.env.RASF_WEBHOOK_COMPANY_MAP) {
    log.error('Rasf webhook is disabled until its secret and tenant map are configured')
    return NextResponse.json({ ok: false, error: 'Service not configured' }, { status: 503 })
  }

  const providedSecret = request.headers.get('x-webhook-secret') ?? request.nextUrl.searchParams.get('secret')
  if (providedSecret !== expectedSecret) {
    log.warn('Rasf webhook rejected: invalid secret')
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const unknownPayload = await request.json().catch(() => null) as unknown
  if (!unknownPayload || typeof unknownPayload !== 'object' || Array.isArray(unknownPayload)) {
    return NextResponse.json({ ok: false, error: 'Invalid JSON object' }, { status: 400 })
  }
  const payload = unknownPayload as Record<string, unknown>

  const routingKey = pick(payload, [
    'instance_name', 'instance', 'session', 'recipient', 'to',
    'data.instance_name', 'data.instance', 'data.session', 'data.recipient', 'data.to',
  ])
  if (!routingKey) {
    return NextResponse.json({ ok: false, error: 'Missing tenant routing key' }, { status: 400 })
  }

  let companyId: string | null
  try {
    companyId = resolveCompanyFromEnvMap('RASF_WEBHOOK_COMPANY_MAP', String(routingKey))
  } catch (error) {
    log.error('Invalid Rasf tenant map', error)
    return NextResponse.json({ ok: false, error: 'Tenant routing is misconfigured' }, { status: 503 })
  }
  if (!companyId) {
    log.warn('Rasf webhook rejected: routing key is not mapped', { routingKey })
    return NextResponse.json({ ok: false, error: 'Unknown tenant routing key' }, { status: 400 })
  }

  const eventId = String(
    pick(payload, ['message_id', 'id', 'message.id', 'data.id', 'data.message_id'])
      ?? `rasf-${crypto.randomUUID()}`,
  )
  const phone = normalizePhone(String(pick(payload, [
    'from', 'phone', 'mobile', 'customer_phone', 'sender',
    'contact.phone', 'message.from', 'data.from', 'data.phone', 'data.customer_phone', 'data.sender',
  ]) ?? ''))
  const text = String(pick(payload, [
    'text', 'message', 'body', 'content',
    'message.text', 'message.body', 'data.text', 'data.message', 'data.body', 'data.content',
  ]) ?? '').trim()

  if (!phone || !text) {
    return NextResponse.json({ ok: true, received: true, processed: false, reason: 'missing phone or text' })
  }

  const supabase = createServiceClient()
  const { error: webhookError } = await supabase.from('webhook_events').insert({
    provider: 'rasf', event_id: eventId, event_type: 'message', payload,
  })
  if (webhookError?.code === '23505') {
    return NextResponse.json({ ok: true, received: true, processed: false, reason: 'duplicate event' })
  }
  if (webhookError) {
    log.error('Rasf webhook event insert failed', webhookError, { eventId })
    return NextResponse.json({ ok: false, error: 'Webhook event save failed' }, { status: 500 })
  }

  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id, company_id')
    .eq('company_id', companyId)
    .or(`whatsapp.eq.${phone},whatsapp.eq.+${phone},phone.eq.${phone},phone.eq.+${phone}`)
    .limit(1)
    .maybeSingle()

  if (customerError) {
    log.error('Rasf customer lookup failed', customerError, { companyId })
    return NextResponse.json({ ok: false, error: 'Customer lookup failed' }, { status: 500 })
  }
  if (!customer) {
    log.info('Rasf message from unknown tenant sender', { companyId, phone })
    return NextResponse.json({ ok: true, received: true, processed: false, reason: 'customer not found' })
  }

  const { data: latestDebt, error: debtError } = await supabase
    .from('debts')
    .select('id')
    .eq('company_id', companyId)
    .eq('customer_id', customer.id)
    .not('status', 'in', '("settled","written_off")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (debtError) {
    log.error('Rasf debt lookup failed', debtError, { companyId, customerId: customer.id })
    return NextResponse.json({ ok: false, error: 'Debt lookup failed' }, { status: 500 })
  }

  const debtId = latestDebt?.id ?? null
  const { data: savedMessage, error: messageError } = await supabase
    .from('messages')
    .insert({
      company_id: companyId,
      customer_id: customer.id,
      debt_id: debtId,
      channel: 'whatsapp',
      direction: 'inbound',
      content: text,
      status: 'delivered',
      whatsapp_message_id: eventId,
      sent_at: new Date().toISOString(),
      metadata: { provider: 'rasf', phone, routing_key: String(routingKey), raw: payload },
    })
    .select('id')
    .single()

  if (messageError) {
    log.error('Failed to save Rasf inbound message', messageError, { companyId, customerId: customer.id })
    return NextResponse.json({ ok: false, error: 'Message save failed' }, { status: 500 })
  }

  const { error: timelineError } = await supabase.from('timeline_events').insert({
    company_id: companyId,
    customer_id: customer.id,
    debt_id: debtId,
    event_type: 'whatsapp_in',
    channel: 'whatsapp',
    actor_type: 'customer',
    summary: 'رسالة واردة عبر Rasf',
    detail: text,
    occurred_at: new Date().toISOString(),
    metadata: { provider: 'rasf', message_id: eventId, phone },
  })
  if (timelineError) log.error('Rasf timeline event insert failed', timelineError, { companyId, customerId: customer.id })

  return NextResponse.json({
    ok: true,
    received: true,
    processed: true,
    customer_id: customer.id,
    message_id: savedMessage.id,
  })
}
