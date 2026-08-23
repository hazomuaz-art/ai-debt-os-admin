import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkWahaHealth } from '@/lib/waha-health'

describe('checkWahaHealth', () => {
  beforeEach(() => {
    process.env.WAHA_API_URL = 'http://waha.internal'
    process.env.WAHA_API_KEY = 'test-key'
    process.env.WAHA_SESSION = 'default'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a non-working session as an error even with webhooks configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: 'default',
      status: 'FAILED',
      config: {
        webhooks: [{
          url: 'http://app/webhook',
          events: ['message'],
          customHeaders: [{ name: 'X-Webhook-Secret', value: 'hidden' }],
        }],
      },
    }), { status: 200 })))

    const result = await checkWahaHealth()

    expect(result.status).toBe('error')
    expect(result.sessionStatus).toBe('FAILED')
    expect(result.message).toContain('expected WORKING')
  })

  it('reports healthy only for WORKING with an authenticated webhook', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      name: 'default',
      status: 'WORKING',
      config: {
        webhooks: [{
          url: 'http://app/webhook',
          events: ['message'],
          customHeaders: [{ name: 'X-Webhook-Secret', value: 'hidden' }],
        }],
      },
    }), { status: 200 })))

    const result = await checkWahaHealth()

    expect(result.status).toBe('ok')
    expect(result.webhooks[0].has_custom_secret_header).toBe(true)
  })
})
