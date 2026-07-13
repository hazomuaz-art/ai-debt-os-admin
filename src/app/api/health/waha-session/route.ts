import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Read-only WAHA session diagnostic. Public (no secret required) — same
// precedent as /api/health, and it exposes zero sensitive values: webhook
// URLs and boolean "is a custom header present" only, NEVER header/secret
// VALUES. Built to answer one question directly from WAHA's own session
// config, since the WhatsApp session's "connected" state (checked
// elsewhere) says nothing about whether WAHA's webhook delivery to this app
// is actually configured/working — the exact blind spot behind the 2026-07-
// 09/10 P0 incident (~25h of customer messages silently discarded).
export async function GET() {
  const apiUrl = (process.env.WAHA_API_URL ?? '').replace(/\/$/, '')
  const apiKey = process.env.WAHA_API_KEY ?? ''
  const session = process.env.WAHA_SESSION || 'default'

  if (!apiUrl || !apiKey) {
    return NextResponse.json({ status: 'error', message: 'WAHA_API_URL/WAHA_API_KEY not configured on this server' }, { status: 500 })
  }

  try {
    const r = await fetch(`${apiUrl}/api/sessions/${session}`, {
      headers: { 'X-Api-Key': apiKey },
      cache: 'no-store',
    })
    const text = await r.text()
    let json: any
    try { json = JSON.parse(text) } catch { json = null }

    if (!r.ok || !json) {
      return NextResponse.json({
        status: 'error',
        http_status: r.status,
        message: 'Could not read session config from WAHA',
        raw_preview: text.slice(0, 500),
      }, { status: 502 })
    }

    const webhooks: any[] = json?.config?.webhooks ?? []
    const safeWebhooks = webhooks.map((w: any) => ({
      url: w?.url ?? null,
      events: w?.events ?? null,
      has_custom_secret_header: Array.isArray(w?.customHeaders)
        ? w.customHeaders.some((h: any) => String(h?.name ?? '').toLowerCase() === 'x-webhook-secret')
        : false,
      // hmac/customHeaders VALUES deliberately never included in the response.
    }))

    // Root-cause fix (2026-07-13 full-system audit): this endpoint's own
    // stated purpose is to catch the exact misconfiguration behind the
    // 2026-07-09/10 P0 incident (WAHA's webhook silently not calling this
    // app), yet it always returned status:'ok' as long as the WAHA API
    // itself responded — even with zero webhooks configured at all. The two
    // unambiguous failure signals available without guessing the "correct"
    // URL (which legitimately varies — WAHA calls back via a Docker bridge
    // IP, not the public one, so a plain string match isn't meaningful) are:
    // no webhook registered, or a webhook registered with no auth header.
    const noWebhookConfigured = webhooks.length === 0
    const noAuthenticatedWebhook = webhooks.length > 0 && !safeWebhooks.some(w => w.has_custom_secret_header)
    const status = noWebhookConfigured ? 'error' : noAuthenticatedWebhook ? 'warn' : 'ok'

    return NextResponse.json({
      status,
      session_name: json?.name ?? session,
      session_status: json?.status ?? 'unknown',
      webhook_count: webhooks.length,
      webhooks: safeWebhooks,
      expected_webhook_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://72.62.30.109'}/api/whatsapp/waha-webhook`,
      raw_config_keys: json?.config ? Object.keys(json.config) : [],
      ...(noWebhookConfigured ? { message: 'No webhook is registered on this WAHA session — inbound customer messages cannot reach this app at all.' } : {}),
      ...(noAuthenticatedWebhook ? { message: 'A webhook is registered but none carry the X-Webhook-Secret header — requests will be rejected as unauthenticated.' } : {}),
    })
  } catch (err) {
    return NextResponse.json({
      status: 'error',
      message: err instanceof Error ? err.message : 'fetch failed',
    }, { status: 502 })
  }
}
