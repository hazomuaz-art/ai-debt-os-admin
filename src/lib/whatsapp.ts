import { createLogger, captureError } from '@/lib/logger'

const log = createLogger('whatsapp')

const WHATSAPP_API_URL  = 'https://graph.facebook.com/v20.0'
const SEND_TIMEOUT_MS   = 15_000
const MAX_MESSAGE_BYTES = 4096

export interface SendMessageOptions {
  to:              string
  message:         string
  phone_number_id?: string
  company_id?:     string
}

export interface SendResult {
  message_id:  string | null
  status:      'sent' | 'failed'
  error?:      string
  error_code?: number
}

export interface WhatsAppWebhookEntry {
  id:      string
  changes: Array<{
    field: string
    value: {
      messaging_product: string
      metadata: { display_phone_number: string; phone_number_id: string }
      contacts?: Array<{ profile: { name: string }; wa_id: string }>
      messages?: Array<{
        from:       string
        id:         string
        timestamp:  string
        type:       string
        text?:      { body: string }
        button?:    { payload: string; text: string }
      }>
      statuses?: Array<{
        id:           string
        status:       'sent' | 'delivered' | 'read' | 'failed'
        timestamp:    string
        recipient_id: string
        errors?:      Array<{ code: number; title: string }>
      }>
    }
  }>
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length === 10) return '966' + digits.slice(1)
  return digits
}

function truncateMessage(message: string): string {
  if (Buffer.byteLength(message, 'utf8') <= MAX_MESSAGE_BYTES) return message
  let t = message
  while (Buffer.byteLength(t + 'â€¦', 'utf8') > MAX_MESSAGE_BYTES) t = t.slice(0, -10)
  return t + 'â€¦'
}

import { createServiceClient } from '@/lib/supabase/server'

export async function sendWhatsAppMessage(options: SendMessageOptions): Promise<SendResult> {
  let evolutionUrl = process.env.EVOLUTION_API_URL
  let evolutionKey = process.env.EVOLUTION_API_KEY
  let evolutionInstance = process.env.EVOLUTION_INSTANCE_NAME

  if (options.company_id) {
    const supabase = createServiceClient()
    const { data: settings } = await supabase
      .from('integration_settings')
      .select('config')
      .eq('company_id', options.company_id)
      .eq('integration_name', 'evolution_whatsapp')
      .eq('enabled', true)
      .maybeSingle()

    if (settings?.config) {
      const config = settings.config as Record<string, string>
      evolutionUrl = config.api_url || evolutionUrl
      evolutionKey = config.api_key || evolutionKey
      evolutionInstance = config.instance_name || evolutionInstance
    }
  }

  if (evolutionUrl && evolutionKey && evolutionInstance) {
    const to = normalizePhone(options.to)
    const message = truncateMessage(options.message)

    try {
      const response = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${evolutionInstance}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
        body: JSON.stringify({ number: to, text: message }),
      })

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        return { message_id: null, status: 'failed', error: data?.message ?? `Evolution HTTP ${response.status}` }
      }

      return {
        message_id: data?.key?.id ?? data?.messageId ?? null,
        status: 'sent',
      }
    } catch (err) {
      return { message_id: null, status: 'failed', error: err instanceof Error ? err.message : 'Evolution send failed' }
    }
  }

  const phoneNumberId = options.phone_number_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    log.warn('WhatsApp not configured - message not sent')
    return { message_id: null, status: 'failed', error: 'WhatsApp credentials not configured' }
  }

  const to      = normalizePhone(options.to)
  const message = truncateMessage(options.message)

  if (to.length < 10 || to.length > 15) {
    return { message_id: null, status: 'failed', error: `Invalid phone: ${options.to}` }
  }

  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS)

  try {
    const response = await fetch(`${WHATSAPP_API_URL}/${phoneNumberId}/messages`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: message },
      }),
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const data = await response.json()

    if (!response.ok) {
      const errMsg  = data.error?.message ?? `HTTP ${response.status}`
      const errCode = data.error?.code
      log.error('WhatsApp API error', undefined, { to, status: response.status, error: errMsg, error_code: errCode })
      return { message_id: null, status: 'failed', error: errMsg, error_code: errCode }
    }

    const messageId = data.messages?.[0]?.id ?? null
    log.info('WhatsApp message sent', { to, message_id: messageId })
    return { message_id: messageId, status: 'sent' }
  } catch (err) {
    clearTimeout(timeout)
    if ((err as any)?.name === 'AbortError') {
      return { message_id: null, status: 'failed', error: 'Send timed out after 15s' }
    }
    captureError(err, 'whatsapp_error', { to })
    return { message_id: null, status: 'failed', error: err instanceof Error ? err.message : 'Network error' }
  }
}

export interface ParsedMessage {
  from:      string
  id:        string
  text:      string
  timestamp: string
  type:      string
}

export interface ParsedStatus {
  message_id:   string
  status:       'sent' | 'delivered' | 'read' | 'failed'
  recipient:    string
  error_code?:  number
  error_title?: string
}

export function parseWebhookPayload(body: { object: string; entry: WhatsAppWebhookEntry[] }): {
  messages: ParsedMessage[]
  statuses: ParsedStatus[]
} {
  const messages: ParsedMessage[] = []
  const statuses: ParsedStatus[]  = []

  if (body.object !== 'whatsapp_business_account') return { messages, statuses }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue

      for (const msg of change.value.messages ?? []) {
        if (msg.type === 'text' && msg.text?.body) {
          messages.push({ from: msg.from, id: msg.id, text: msg.text.body, timestamp: msg.timestamp, type: 'text' })
        } else if (msg.type === 'button' && msg.button) {
          messages.push({ from: msg.from, id: msg.id, text: msg.button.text, timestamp: msg.timestamp, type: 'button' })
        }
      }

      for (const status of change.value.statuses ?? []) {
        const parsed: ParsedStatus = {
          message_id: status.id,
          status:     status.status,
          recipient:  status.recipient_id,
        }
        if (status.errors?.[0]) {
          parsed.error_code  = status.errors[0].code
          parsed.error_title = status.errors[0].title
        }
        statuses.push(parsed)
      }
    }
  }

  return { messages, statuses }
}

export function isValidWhatsAppNumber(phone: string): boolean {
  const n = normalizePhone(phone)
  return /^\d{10,15}$/.test(n) && !n.startsWith('0')
}

