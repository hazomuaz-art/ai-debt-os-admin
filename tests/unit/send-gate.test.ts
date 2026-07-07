import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression tests for a real production incident (2026-07-06): dozens of
// campaign customers received 3-5 unprompted "campaign" messages each with
// zero reply in between, and separately the campaign engine kept attempting
// sends for 90+ minutes into a WhatsApp session that was already confirmed
// disconnected — and, days apart, this same 6-day-old number was silently
// blocked by WhatsApp TWICE (2026-06-30, 2026-07-06) because delivery
// quality had already degraded before the slower external health check
// caught it. These tests prove every guard that closes those holes.

let mockLastMessage: { direction: string; sent_at: string } | null = null
let mockUnresolvedHealthAlert: { id: string } | null = null
let mockQualityMessages: { status: string }[] = []
let mockReconnectAlert: { resolved_at: string } | null = null
let mockNumberCreatedAt: string | null = null

// Generic chainable query-builder mock — every filter method just records
// itself and returns `this`; the terminal method (maybeSingle/then) decides
// what to resolve based on the table and which columns were selected.
function makeChain(table: string, selectedCols: string) {
  const chain: any = {
    eq: () => chain,
    gte: () => chain,
    lte: () => chain,
    in: () => chain,
    contains: () => chain,
    not: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => resolve().then((r: any) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })),
    then: (res: any, rej: any) => resolve().then(res, rej),
  }
  function resolve(): Promise<any> {
    if (table === 'messages' && selectedCols.includes('direction')) return Promise.resolve({ data: mockLastMessage, error: null })
    if (table === 'messages' && selectedCols.includes('status')) return Promise.resolve({ data: mockQualityMessages, error: null })
    if (table === 'system_alerts' && selectedCols.includes('id')) return Promise.resolve({ data: mockUnresolvedHealthAlert, error: null })
    if (table === 'system_alerts' && selectedCols.includes('resolved_at')) return Promise.resolve({ data: mockReconnectAlert, error: null })
    if (table === 'portfolio_whatsapp_numbers') return Promise.resolve({ data: mockNumberCreatedAt ? { created_at: mockNumberCreatedAt } : null, error: null })
    throw new Error(`unexpected query in test: table=${table} cols=${selectedCols}`)
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockImplementation((cols: string) => makeChain(table, cols)),
    })),
  })),
}))

import {
  canSendUnpromptedMessage, isWhatsAppSessionHealthy, FOLLOW_UP_AFTER_MS,
  isDeliveryQualityHealthy, getWarmupDailyLimit,
} from '@/lib/send-gate'

describe('canSendUnpromptedMessage — the one-message-until-reply-or-3-days rule', () => {
  beforeEach(() => { mockLastMessage = null })

  it('allows the very first contact when no message has ever been sent', async () => {
    mockLastMessage = null
    const result = await canSendUnpromptedMessage('cust-1')
    expect(result.allowed).toBe(true)
  })

  it('blocks a second unprompted send while the customer has not replied and less than 3 days have passed', async () => {
    mockLastMessage = { direction: 'outbound', sent_at: new Date(Date.now() - 60_000).toISOString() } // 1 minute ago
    const result = await canSendUnpromptedMessage('cust-2')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('awaiting_reply_within_window')
  })

  it('blocks even after hours if still under the 3-day window (this is exactly what broke in production)', async () => {
    mockLastMessage = { direction: 'outbound', sent_at: new Date(Date.now() - 4 * 3600_000).toISOString() } // 4 hours ago
    const result = await canSendUnpromptedMessage('cust-3')
    expect(result.allowed).toBe(false)
  })

  it('allows a follow-up once 3 full days have passed with no reply', async () => {
    mockLastMessage = { direction: 'outbound', sent_at: new Date(Date.now() - FOLLOW_UP_AFTER_MS - 60_000).toISOString() }
    const result = await canSendUnpromptedMessage('cust-4')
    expect(result.allowed).toBe(true)
  })

  it('blocks an unprompted campaign send while the customer is mid-conversation (their last message was inbound)', async () => {
    mockLastMessage = { direction: 'inbound', sent_at: new Date(Date.now() - 5 * 60_000).toISOString() } // replied 5 min ago
    const result = await canSendUnpromptedMessage('cust-5')
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toBe('customer_in_active_conversation')
  })
})

describe('isWhatsAppSessionHealthy — circuit breaker', () => {
  beforeEach(() => { mockUnresolvedHealthAlert = null })

  it('reports healthy when there is no unresolved connectivity/delivery alert', async () => {
    mockUnresolvedHealthAlert = null
    expect(await isWhatsAppSessionHealthy()).toBe(true)
  })

  it('reports UNHEALTHY when an unresolved whatsapp_disconnected/delivery_failure alert exists — this is the exact real alert the system raised at 11:30 and 12:00 in production while the campaign engine kept sending anyway', async () => {
    mockUnresolvedHealthAlert = { id: 'alert-1' }
    expect(await isWhatsAppSessionHealthy()).toBe(false)
  })
})

describe('isDeliveryQualityHealthy — real-time Meta-policy quality gate', () => {
  beforeEach(() => { mockQualityMessages = [] })

  it('reports healthy when the sample is too small to judge (avoids false alarms on a quiet campaign)', async () => {
    mockQualityMessages = [{ status: 'delivered' }, { status: 'failed' }] // only 2, below minSample
    const result = await isDeliveryQualityHealthy()
    expect(result.healthy).toBe(true)
  })

  it('reports UNHEALTHY at a 25% delivery ratio — the exact real ratio (37/149) that preceded a silent WhatsApp block in production', async () => {
    mockQualityMessages = [
      { status: 'delivered' }, { status: 'delivered' },
      { status: 'failed' }, { status: 'failed' }, { status: 'failed' }, { status: 'failed' }, { status: 'failed' }, { status: 'failed' },
    ] // 2/8 = 25%, sample size 8 clears the minSample(5) threshold
    const result = await isDeliveryQualityHealthy()
    expect(result.healthy).toBe(false)
    expect(result.ratio).toBe(0.25)
  })

  it('reports healthy at a normal, real delivery ratio', async () => {
    mockQualityMessages = Array(10).fill({ status: 'delivered' })
    const result = await isDeliveryQualityHealthy()
    expect(result.healthy).toBe(true)
    expect(result.ratio).toBe(1)
  })
})

describe('getWarmupDailyLimit — Meta-tier-inspired ramp for a new/reconnected number', () => {
  beforeEach(() => { mockReconnectAlert = null; mockNumberCreatedAt = null })

  it('caps a just-reconnected number to the lowest tier (30/day), regardless of its configured ceiling', async () => {
    mockReconnectAlert = { resolved_at: new Date(Date.now() - 1 * 3600_000).toISOString() } // reconnected 1 hour ago
    const limit = await getWarmupDailyLimit('num-1', 250)
    expect(limit).toBe(30)
  })

  it('allows a mid-tier ramp (80/day) once the number has held for a few days', async () => {
    mockReconnectAlert = { resolved_at: new Date(Date.now() - 3 * 24 * 3600_000).toISOString() } // 3 days ago
    const limit = await getWarmupDailyLimit('num-1', 250)
    expect(limit).toBe(80)
  })

  it('returns the full configured limit only once the number is well past the warm-up window', async () => {
    mockReconnectAlert = { resolved_at: new Date(Date.now() - 15 * 24 * 3600_000).toISOString() } // 15 days ago
    const limit = await getWarmupDailyLimit('num-1', 250)
    expect(limit).toBe(250)
  })

  it('falls back to the number record creation date when there is no resolved disconnect alert on file', async () => {
    mockReconnectAlert = null
    mockNumberCreatedAt = new Date(Date.now() - 1 * 24 * 3600_000).toISOString() // created yesterday
    const limit = await getWarmupDailyLimit('num-1', 250)
    expect(limit).toBe(30) // still inside the tightest warm-up window
  })
})
