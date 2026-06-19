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
  let n8nEnabled = false
  let n8nConfig: Record<string, string> | null = null

  if (options.company_id) {
    const supabase = createServiceClient()
    
    // Check n8n automation first
    const { data: n8nSettings } = await supabase
      .from('integration_settings')
      .select('config')
      .eq('company_id', options.company_id)
      .eq('integration_name', 'n8n_automation')
      .eq('enabled', true)
      .maybeSingle()
      
    if (n8nSettings?.config) {
      n8nEnabled = true
      n8nConfig = n8nSettings.config as Record<string, string>
    }

    // Also get evolution settings as fallback payload
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

  const to = normalizePhone(options.to)
  const message = truncateMessage(options.message)

  // 0. WAHA (browser-based gateway) — takes priority when configured.
  // Uses the real WhatsApp Web client, so it resolves LID-migrated contacts
  // automatically (sending to <number>@c.us is routed to the correct @lid),
  // which the Baileys-based Evolution gateway fails to do.
  const wahaUrl     = process.env.WAHA_API_URL
  const wahaKey     = process.env.WAHA_API_KEY
  const wahaSession = process.env.WAHA_SESSION || 'default'
  if (wahaUrl && wahaKey) {
    const base = wahaUrl.replace(/\/$/, '')
    const chatId = `${to}@c.us`

    // Warm-up: WhatsApp Web silently drops the very first message(s) to a
    // brand-new contact while it establishes the e2e encryption session,
    // even though the send API still reports success. A typing-presence
    // ping forces that handshake to happen BEFORE we send real content,
    // which avoids the loss. Cheap (~1.5s) and applied to every send since
    // there's no reliable way to know in advance which contacts are "new".
    try {
      await fetch(`${base}/api/startTyping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': wahaKey },
        body: JSON.stringify({ session: wahaSession, chatId }),
      })
      await new Promise(r => setTimeout(r, 1500))
    } catch {
      // Non-fatal — proceed to send even if the warm-up ping itself failed.
    }

    try {
      const response = await fetch(`${base}/api/sendText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': wahaKey },
        body: JSON.stringify({ session: wahaSession, chatId, text: message }),
      })
      const data = await response.json().catch(() => ({} as any))
      if (!response.ok) {
        const errMsg = data?.message || data?.error || `HTTP ${response.status}`
        log.error('WAHA send failed', undefined, { to, error: String(errMsg) })
        return { message_id: null, status: 'failed', error: String(errMsg) }
      }
      const messageId = data?._data?.id?._serialized || data?.id?._serialized || data?.id || null
      log.info('WAHA message sent', { to, message_id: messageId })
      return { message_id: messageId, status: 'sent' }
    } catch (err) {
      log.error('WAHA send exception', err as Error, { to })
      return { message_id: null, status: 'failed', error: err instanceof Error ? err.message : 'WAHA send failed' }
    }
  }

  // 1. If n8n is enabled, route via n8n webhook
  if (n8nEnabled && options.company_id) {
    const { getN8nClient } = await import('@/lib/n8n/client')
    const n8nClient = getN8nClient()
    
    log.info('Routing WhatsApp message via n8n', { to, company_id: options.company_id })
    
    const result = await n8nClient.sendWhatsAppMessage({
      company_id: options.company_id,
      customer_id: 'unknown', // Typically resolved before calling this, but we pass what we have
      phone_number: to,
      message: message,
      instance_name: evolutionInstance ?? 'default',
    })

    if (!result.success) {
      return { message_id: null, status: 'failed', error: result.error ?? 'n8n webhook failed' }
    }

    return {
      message_id: `n8n-${Date.now()}`,
      status: 'sent',
    }
  }

  // 2. Direct Evolution API
  if (evolutionUrl && evolutionKey && evolutionInstance) {
    console.log('[whatsapp] Sending DIRECTLY via Evolution API:', {
      url: `${evolutionUrl}/message/sendText/${evolutionInstance}`,
      to: to,
      rawTo: options.to,
      messageLength: message.length,
    })

    try {
      const response = await fetch(`${evolutionUrl.replace(/\/$/, '')}/message/sendText/${evolutionInstance}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: evolutionKey },
        body: JSON.stringify({ number: to, text: message }),
      })

      const data = await response.json().catch(() => ({}))
      console.log('[whatsapp] Evolution API response:', { status: response.status, ok: response.ok, data: JSON.stringify(data) })

      if (!response.ok) {
        const errMsg = typeof data?.response?.message === 'string' 
          ? data.response.message 
          : JSON.stringify(data?.response?.message ?? data?.message ?? `HTTP ${response.status}`)
        console.error('[whatsapp] Evolution API FAILED:', errMsg)
        return { message_id: null, status: 'failed', error: errMsg }
      }

      const messageId = data?.key?.id ?? data?.messageId ?? null
      console.log('[whatsapp] Evolution API SUCCESS. message_id:', messageId)
      return {
        message_id: messageId,
        status: 'sent',
      }
    } catch (err) {
      console.error('[whatsapp] Evolution API EXCEPTION:', err)
      return { message_id: null, status: 'failed', error: err instanceof Error ? err.message : 'Evolution send failed' }
    }
  }

  const phoneNumberId = options.phone_number_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID
  const accessToken   = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneNumberId || !accessToken) {
    log.warn('WhatsApp not configured - message not sent')
    return { message_id: null, status: 'failed', error: 'WhatsApp credentials not configured' }
  }



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

// Fetches the base64 of a media (image) message from Evolution API.
export async function getMediaBase64(args: {
  instance?: string
  messageKey: any
  company_id?: string
}): Promise<string | null> {
  let url = process.env.EVOLUTION_API_URL
  let key = process.env.EVOLUTION_API_KEY
  let instance = args.instance || process.env.EVOLUTION_INSTANCE_NAME
  if (args.company_id) {
    const supabase = createServiceClient()
    const { data } = await supabase.from('integration_settings').select('config')
      .eq('company_id', args.company_id).eq('integration_name', 'evolution_whatsapp').eq('enabled', true).maybeSingle()
    const c = data?.config as Record<string, string> | undefined
    if (c) { url = c.api_url || url; key = c.api_key || key; instance = c.instance_name || instance }
  }
  if (!url || !key || !instance) return null
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${instance}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: key },
      body: JSON.stringify({ message: { key: args.messageKey }, convertToMp4: false }),
    })
    const d = await r.json().catch(() => ({} as any))
    return (d?.base64 as string) || null
  } catch {
    return null
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

