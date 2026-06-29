// Email channel — infrastructure only, no real provider wired yet.
// Mirrors src/lib/whatsapp.ts's sendWhatsAppMessage exactly on purpose: same
// per-company override pattern (integration_settings, integration_name =
// 'email'), same SendResult shape, same "never throws, returns a clear
// failure" contract — so every call site that already knows how to handle a
// WhatsApp send result can handle an email send result identically.
//
// Until EMAIL_PROVIDER/EMAIL_API_KEY are actually set (env or per-company
// integration_settings), every call returns a clean 'failed' result with an
// explanatory error — this never breaks anything else in the app, it's
// simply unconfigured. Wiring a real provider (Postmark/Mailgun/Resend) is
// a single change: fill in the marked block below with that provider's
// actual HTTP call once a domain/API key exists.
import { createLogger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/server'

const log = createLogger('email')

export interface SendEmailOptions {
  to:          string
  subject:     string
  body:        string
  company_id?: string
}

export interface SendEmailResult {
  message_id: string | null
  status:     'sent' | 'failed'
  error?:     string
}

export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  let provider  = process.env.EMAIL_PROVIDER
  let apiKey    = process.env.EMAIL_API_KEY
  let fromAddr  = process.env.EMAIL_FROM_ADDRESS

  if (options.company_id) {
    const supabase = createServiceClient()
    const { data: settings } = await supabase
      .from('integration_settings')
      .select('config')
      .eq('company_id', options.company_id)
      .eq('integration_name', 'email')
      .eq('enabled', true)
      .maybeSingle()

    if (settings?.config) {
      const config = settings.config as Record<string, string>
      provider = config.provider  || provider
      apiKey   = config.api_key   || apiKey
      fromAddr = config.from_address || fromAddr
    }
  }

  if (!provider || !apiKey || !fromAddr) {
    log.warn('sendEmail called with no email provider configured — set EMAIL_PROVIDER/EMAIL_API_KEY/EMAIL_FROM_ADDRESS (or a company integration_settings row) before this can actually send', {
      company_id: options.company_id, to: options.to,
    })
    return { message_id: null, status: 'failed', error: 'email_provider_not_configured' }
  }

  try {
    // ── Real provider call goes here ──────────────────────────────────────
    // This is the ONE place that needs filling in once a provider is
    // chosen (Postmark/Mailgun/Resend) — everything above (config
    // resolution, the SendEmailResult contract, every caller) is already
    // ready and needs no further changes.
    log.error('sendEmail: provider configured but no actual send implementation wired yet', undefined, { provider })
    return { message_id: null, status: 'failed', error: 'email_provider_not_implemented' }
  } catch (err) {
    log.error('sendEmail failed', err as Error)
    return { message_id: null, status: 'failed', error: err instanceof Error ? err.message : String(err) }
  }
}
