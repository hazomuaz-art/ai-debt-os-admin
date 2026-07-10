import { describe, it, expect, vi, beforeEach } from 'vitest'

// 🔴 P0 PRODUCTION INCIDENT (2026-07-09/10): the WAHA webhook secret-check
// branch returned `{status:'ok'}` (HTTP 200) on ANY mismatch, with only a
// server-only `log.warn` — no system_alert, no trace anywhere else. WAHA had
// zero reason to distrust the "ok" response or retry, so if its own stored
// secret ever drifted from the app's env (a session reconnect resetting
// custom headers, an env var change), every single real customer message
// vanished silently. Confirmed live: ~25 hours of total inbound blackout
// with this exact signature — WAHA's session showed "connected" (that only
// reflects its link to WhatsApp, not whether its webhook calls to us are
// even succeeding) while the app itself was healthy and reachable. This
// proves the fix: a genuine secret mismatch now raises a critical
// system_alert on first occurrence, with a cooldown so a malicious/broken
// repeated prober can't spam the alerts table.

let systemAlertCalls: any[] = []
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        or: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }),
        eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) }),
      }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
  })),
}))
vi.mock('@/lib/whatsapp', () => ({
  normalizePhone: (p: string) => p,
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ message_id: 'wam-1', status: 'sent' }),
}))
vi.mock('@/lib/system-alerts', () => ({
  insertSystemAlert: vi.fn().mockImplementation(async (a: any) => { systemAlertCalls.push(a) }),
}))
vi.mock('@/lib/payment-receipt', () => ({ processInboundReceipt: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/automation-pipeline', () => ({ processEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ai-collector-agent', () => ({
  runCollectorAgent: vi.fn().mockResolvedValue({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام.' }),
  detectSignals: vi.fn().mockReturnValue({ deniesPromise: false, refusesToPay: false }),
}))
vi.mock('@/lib/case-note', () => ({ updateCaseNote: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/timeline', () => ({ insertTimelineEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/document-classifier', () => ({ classifyDocumentImage: vi.fn(), classifyDocumentPdf: vi.fn() }))

process.env.WAHA_WEBHOOK_SECRET = 'the-real-secret'
process.env.WAHA_API_URL = 'http://waha.test'
process.env.WAHA_API_KEY = 'waha-key'

import { POST, __resetWahaWebhookStateForTests } from '@/app/api/whatsapp/waha-webhook/route'

function makeRequest(secretHeader: string | null): any {
  return {
    json: async () => ({ event: 'message', payload: { fromMe: false, from: '966500000000@c.us', body: 'hi', timestamp: 1000, id: { _serialized: 'x' } } }),
    headers: { get: (name: string) => (name.toLowerCase() === 'x-webhook-secret' ? secretHeader : null) },
  } as any
}

beforeEach(() => {
  systemAlertCalls = []
  __resetWahaWebhookStateForTests()
  vi.useRealTimers()
})

describe('waha-webhook — secret mismatch no longer fails silently', () => {
  it('still returns 200 "ok" to WAHA (never leaks auth-checking behavior to a prober) but raises a critical system_alert on the first mismatch', async () => {
    const res = await POST(makeRequest('wrong-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ status: 'ok' })

    const alert = systemAlertCalls.find(a => a.alert_type === 'webhook_auth_mismatch')
    expect(alert).toBeDefined()
    expect(alert.severity).toBe('critical')
  })

  it('does not spam an alert for every rejected request within the cooldown window — only the first', async () => {
    await POST(makeRequest('wrong-secret'))
    await POST(makeRequest('wrong-secret'))
    await POST(makeRequest('still-wrong'))

    const alerts = systemAlertCalls.filter(a => a.alert_type === 'webhook_auth_mismatch')
    expect(alerts.length).toBe(1)
  })

  it('a request with a missing secret header entirely is treated the same as a mismatch (alerted, not silently dropped)', async () => {
    await POST(makeRequest(null))

    const alert = systemAlertCalls.find(a => a.alert_type === 'webhook_auth_mismatch')
    expect(alert).toBeDefined()
  })

  it('a request with the CORRECT secret never raises this alert', async () => {
    await POST(makeRequest('the-real-secret'))

    const alert = systemAlertCalls.find(a => a.alert_type === 'webhook_auth_mismatch')
    expect(alert).toBeUndefined()
  })
})
