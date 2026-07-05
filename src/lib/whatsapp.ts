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
  // Per-portfolio WAHA session override (e.g. for campaigns sending from a
  // specific portfolio's linked number instead of the company-wide default
  // session). The API key is still always resolved company-wide/from env —
  // only the session name and server URL are overridable, matching the
  // existing portfolio_whatsapp_numbers connect/QR flow's own resolution.
  waha_session?:   string | null
  waha_api_url?:   string | null
  // When provided, this call is checked against the customer's opt-out flag
  // before sending anything. CST anti-spam rules require ALL messaging to
  // stop within 24h of a stop request - previously this was only enforced
  // in the live AI-reply path (ai-collector-agent.ts), not in any of the
  // cron jobs (campaigns, follow-ups, retries) that also message customers,
  // so an opted-out customer could still receive a campaign blast or a
  // promise-followup reminder. Omit only for sends that are not "messaging
  // a customer" (e.g. an internal admin alert to a fixed ops phone number).
  customer_id?:    string | null
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
  // Bare Saudi mobile with no leading 0 or country code (e.g. "5XXXXXXXX",
  // typed directly into a phone/whatsapp field) - previously passed through
  // unchanged and silently failed to send since WAHA requires the country
  // code, with no visible error pointing back to the missing "966".
  if (digits.startsWith('5') && digits.length === 9) return '966' + digits
  return digits
}

function truncateMessage(message: string): string {
  if (Buffer.byteLength(message, 'utf8') <= MAX_MESSAGE_BYTES) return message
  let t = message
  while (Buffer.byteLength(t + 'â€¦', 'utf8') > MAX_MESSAGE_BYTES) t = t.slice(0, -10)
  return t + 'â€¦'
}

import { createServiceClient } from '@/lib/supabase/server'

// CST (Communications, Space & Technology Commission) anti-spam regulations
// prohibit promotional/commercial messages 10pm-9am Saudi time daily; SAMA's
// debt-collection conduct rules impose a similar "reasonable hours" duty on
// creditors. Enforced here — the single choke point every outbound WhatsApp
// send in this codebase routes through — rather than at each call site,
// since a rule enforced in N places is a rule that will eventually be
// missed in the N+1th. Ramadan has a separate, narrower allowed window
// under CST rules (1am-noon) that requires Hijri-calendar date resolution
// this codebase does not currently have a library for; NOT implemented
// here — flagged as a known gap requiring either a Hijri calendar
// dependency or manual seasonal configuration, not silently approximated.
const CONTACT_HOURS_BLOCKED_START = 22 // 10pm Saudi time
const CONTACT_HOURS_BLOCKED_END   = 9  // 9am Saudi time
const SAUDI_UTC_OFFSET_HOURS = 3

export function isWithinAllowedContactHours(now: Date = new Date()): boolean {
  const saudiHour = (now.getUTCHours() + SAUDI_UTC_OFFSET_HOURS) % 24
  // Blocked window wraps midnight (22:00 -> 09:00), so "blocked" is true
  // when the hour is >= start OR < end, not a simple range check.
  const blocked = saudiHour >= CONTACT_HOURS_BLOCKED_START || saudiHour < CONTACT_HOURS_BLOCKED_END
  return !blocked
}

export async function sendWhatsAppMessage(options: SendMessageOptions): Promise<SendResult> {
  // Compliance gate: this deliberately does NOT distinguish "we contacted
  // them first" from "replying to a message they just sent us" - a lawyer
  // should confirm whether responsive replies to customer-initiated inbound
  // messages are exempt from this window before narrowing this check; the
  // conservative default (block all outbound in the window) is applied
  // until that is confirmed, since under-blocking is the worse mistake here.
  if (!isWithinAllowedContactHours()) {
    log.warn('WhatsApp send blocked - outside allowed contact hours (CST/SAMA)', { to: options.to })
    return { message_id: null, status: 'failed', error: 'blocked_contact_hours' }
  }

  if (options.customer_id) {
    const svc = createServiceClient()
    const { data: customer } = await svc
      .from('customers')
      .select('contact_opt_out')
      .eq('id', options.customer_id)
      .maybeSingle()
    if (customer?.contact_opt_out) {
      log.warn('WhatsApp send blocked - customer opted out of contact', { customer_id: options.customer_id })
      return { message_id: null, status: 'failed', error: 'blocked_contact_opt_out' }
    }
  }

  // WAHA config — env defaults, optionally overridden per-company via
  // integration_settings (integration_name = 'waha').
  let wahaUrl     = process.env.WAHA_API_URL
  let wahaKey     = process.env.WAHA_API_KEY
  let wahaSession = process.env.WAHA_SESSION || 'default'

  if (options.company_id) {
    const supabase = createServiceClient()
    const { data: settings } = await supabase
      .from('integration_settings')
      .select('config')
      .eq('company_id', options.company_id)
      .eq('integration_name', 'waha')
      .eq('enabled', true)
      .maybeSingle()

    if (settings?.config) {
      const config = settings.config as Record<string, string>
      wahaUrl     = config.api_url || wahaUrl
      wahaKey     = config.api_key || wahaKey
      wahaSession = config.session || wahaSession
    }
  }

  // Explicit per-send overrides win over everything above (e.g. a campaign
  // sending from a specific portfolio's linked WhatsApp number/session).
  if (options.waha_api_url) wahaUrl = options.waha_api_url
  if (options.waha_session) wahaSession = options.waha_session

  const to = normalizePhone(options.to)
  const message = truncateMessage(options.message)

  // 1. WAHA (browser-based gateway) — the primary channel.
  // Uses the real WhatsApp Web client, so it resolves LID-migrated contacts
  // automatically (sending to <number>@c.us is routed to the correct @lid).
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
      // Real production root cause (confirmed by directly testing the live
      // WAHA send API): the WEBJS engine returned the message id at
      // data._data.id._serialized / data.id._serialized, which is what the
      // checks below originally covered. Switching the session to the
      // NOWEB engine (done to fix an unrelated connectivity issue) changed
      // the response shape entirely — NOWEB returns the id at
      // `data.key.id` instead. None of the old paths matched it, so EVERY
      // send since that engine switch saved whatsapp_message_id = null.
      // That null id meant the inbound message.ack webhook could never
      // match a delivery confirmation back to its row, so verify-delivery's
      // cron saw these customers as having "zero ever-delivered messages",
      // classified their session as broken, and started auto-retrying their
      // most recent message — which is what actually produced the literal
      // duplicate-text sends reported in production, all while every
      // send had genuinely succeeded already.
      const messageId = data?.key?.id || data?._data?.id?._serialized || data?.id?._serialized || data?.id || null
      log.info('WAHA message sent', { to, message_id: messageId })
      return { message_id: messageId, status: 'sent' }
    } catch (err) {
      log.error('WAHA send exception', err as Error, { to })
      return { message_id: null, status: 'failed', error: err instanceof Error ? err.message : 'WAHA send failed' }
    }
  }

  // 2. Meta WhatsApp Cloud API — fallback when WAHA is not configured.
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

// Downloads a WAHA media attachment (image/PDF) by its URL and returns base64.
// WAHA inbound webhooks expose `payload.media.url`; this fetches it with the
// API key and encodes it for the OCR/receipt pipeline.
export async function getMediaBase64(args: { mediaUrl: string }): Promise<string | null> {
  const key = process.env.WAHA_API_KEY
  if (!args.mediaUrl) return null
  try {
    const r = await fetch(args.mediaUrl, { headers: { 'X-Api-Key': key ?? '' } })
    if (!r.ok) return null
    return Buffer.from(await r.arrayBuffer()).toString('base64')
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

