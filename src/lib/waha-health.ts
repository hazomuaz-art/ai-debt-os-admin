export type WahaHealthStatus = 'ok' | 'warn' | 'error'

export interface SafeWahaWebhook {
  url: string | null
  events: unknown
  has_custom_secret_header: boolean
}

export interface WahaHealthResult {
  status: WahaHealthStatus
  sessionName: string
  sessionStatus: string
  webhooks: SafeWahaWebhook[]
  configKeys: string[]
  message?: string
  httpStatus?: number
}

export async function checkWahaHealth(timeoutMs = 5_000): Promise<WahaHealthResult> {
  const apiUrl = (process.env.WAHA_API_URL ?? '').replace(/\/$/, '')
  const apiKey = process.env.WAHA_API_KEY ?? ''
  const sessionName = process.env.WAHA_SESSION || 'default'

  if (!apiUrl || !apiKey) {
    return {
      status: 'error',
      sessionName,
      sessionStatus: 'NOT_CONFIGURED',
      webhooks: [],
      configKeys: [],
      message: 'WAHA_API_URL/WAHA_API_KEY not configured on this server',
    }
  }

  try {
    const response = await fetch(`${apiUrl}/api/sessions/${encodeURIComponent(sessionName)}`, {
      headers: { 'X-Api-Key': apiKey },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let body: Record<string, unknown> | null = null
    try {
      body = JSON.parse(text) as Record<string, unknown>
    } catch {
      body = null
    }

    if (!response.ok || !body) {
      return {
        status: 'error',
        sessionName,
        sessionStatus: 'UNREACHABLE',
        webhooks: [],
        configKeys: [],
        httpStatus: response.status,
        message: 'Could not read session config from WAHA',
      }
    }

    const config = (body.config && typeof body.config === 'object')
      ? body.config as Record<string, unknown>
      : {}
    const rawWebhooks = Array.isArray(config.webhooks) ? config.webhooks : []
    const webhooks = rawWebhooks.map(raw => {
      const webhook = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
      const customHeaders = Array.isArray(webhook.customHeaders) ? webhook.customHeaders : []
      return {
        url: typeof webhook.url === 'string' ? webhook.url : null,
        events: webhook.events ?? null,
        has_custom_secret_header: customHeaders.some(rawHeader => {
          const header = rawHeader && typeof rawHeader === 'object'
            ? rawHeader as Record<string, unknown>
            : {}
          return String(header.name ?? '').toLowerCase() === 'x-webhook-secret'
        }),
      }
    })

    const sessionStatus = typeof body.status === 'string' ? body.status : 'UNKNOWN'
    const noWebhookConfigured = webhooks.length === 0
    const noAuthenticatedWebhook = webhooks.length > 0
      && !webhooks.some(webhook => webhook.has_custom_secret_header)

    if (sessionStatus !== 'WORKING') {
      return {
        status: 'error',
        sessionName: typeof body.name === 'string' ? body.name : sessionName,
        sessionStatus,
        webhooks,
        configKeys: Object.keys(config),
        message: `WAHA session is ${sessionStatus}; expected WORKING`,
      }
    }

    if (noWebhookConfigured || noAuthenticatedWebhook) {
      return {
        status: noWebhookConfigured ? 'error' : 'warn',
        sessionName: typeof body.name === 'string' ? body.name : sessionName,
        sessionStatus,
        webhooks,
        configKeys: Object.keys(config),
        message: noWebhookConfigured
          ? 'No webhook is registered on this WAHA session'
          : 'No WAHA webhook carries the X-Webhook-Secret header',
      }
    }

    return {
      status: 'ok',
      sessionName: typeof body.name === 'string' ? body.name : sessionName,
      sessionStatus,
      webhooks,
      configKeys: Object.keys(config),
    }
  } catch (error) {
    return {
      status: 'error',
      sessionName,
      sessionStatus: 'UNREACHABLE',
      webhooks: [],
      configKeys: [],
      message: error instanceof Error ? error.message : 'WAHA health check failed',
    }
  }
}
