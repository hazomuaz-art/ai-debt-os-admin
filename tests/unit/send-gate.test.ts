import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression tests for a real production incident (2026-07-06): dozens of
// campaign customers received 3-5 unprompted "campaign" messages each with
// zero reply in between, and separately the campaign engine kept attempting
// sends for 90+ minutes into a WhatsApp session that was already confirmed
// disconnected. These tests prove the two guards that close both holes:
// canSendUnpromptedMessage (one message, then silence until reply or 3
// days) and isWhatsAppSessionHealthy (refuse to send into a known-broken
// session) — independent of any other bookkeeping (queue attempts, retry
// counters) that has already proven fragile under concurrency.

let mockLastMessage: { direction: string; sent_at: string } | null = null
let mockUnresolvedHealthAlert: { id: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'messages') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockLastMessage, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'system_alerts') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: mockUnresolvedHealthAlert, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table in test: ${table}`)
    }),
  })),
}))

import { canSendUnpromptedMessage, isWhatsAppSessionHealthy, FOLLOW_UP_AFTER_MS } from '@/lib/send-gate'

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
