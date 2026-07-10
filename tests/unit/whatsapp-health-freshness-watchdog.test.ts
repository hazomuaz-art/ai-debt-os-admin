import { describe, it, expect, vi, beforeEach } from 'vitest'

// 🔴 P0 PRODUCTION INCIDENT (2026-07-09/10): the existing connection-state
// check in this cron asks WAHA "are you connected?" and WAHA answered
// "yes" (state === 'WORKING') throughout a real ~25-hour total inbound
// blackout — because that question only covers WAHA's own link to
// WhatsApp, not whether ITS webhook calls to THIS app are even succeeding.
// The actual root cause (a webhook-secret mismatch silently discarding
// every event) was invisible to that check by construction. This proves
// the new, independent freshness watchdog: it doesn't ask WAHA anything —
// it asks the one question that actually matters, "has a real customer
// message reached our own database recently?", which would have caught
// this exact incident within its own check interval instead of a full day
// later via a customer complaint.

let mockLastInbound: { created_at: string } | null = null
let mockActiveNumbers: any[] = []
let raisedAlerts: any[] = []
let resolvedAlertTypes: string[] = []

function chainFor(table: string): any {
  if (table === 'portfolio_whatsapp_numbers') {
    return { select: () => ({ eq: () => Promise.resolve({ data: mockActiveNumbers }) }) }
  }
  if (table === 'system_alerts') {
    return {
      // .select('id').eq(...).eq(...) then EITHER .eq(company) OR
      // .is(company, null), then .limit(1).maybeSingle() — every node needs
      // both .eq and .is available since the real code calls .eq() twice
      // unconditionally before the conditional branch.
      select: () => {
        const chain: any = { eq: () => chain, is: () => chain, limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }
        return chain
      },
      update: (row: any) => {
        // The real chain is .update(row).eq(...).eq(...) then EITHER
        // .eq('company_id', x) OR .is('company_id', null), then `await`'d —
        // so every node needs to be both chainable (.eq/.is) AND awaitable
        // (thenable), since the final call in either branch is what gets
        // awaited directly without an extra method call.
        const result = { error: null }
        if (row.is_resolved) resolvedAlertTypes.push('called')
        const chain: any = {
          eq: () => chain,
          is: () => chain,
          then: (resolve: any) => resolve(result),
        }
        return chain
      },
    }
  }
  // messages table: used for (a) last outbound for company_id, (b) delivery-ratio recent outbound, (c) our new last-inbound freshness check.
  return {
    select: () => ({
      eq: (col: string, val: string) => {
        const self: any = {
          eq: (col2: string) => {
            if (col2 === 'direction' ) {
              return {
                order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: val === 'whatsapp' ? mockLastInbound : null }) }) }),
              }
            }
            return self
          },
          order: () => ({
            limit: () => ({
              maybeSingle: () => Promise.resolve({ data: mockLastInbound }),
            }),
          }),
          gte: () => ({ lte: () => ({ limit: () => Promise.resolve({ data: [] }) }) }),
        }
        return self
      },
    }),
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => chainFor(table)),
  })),
}))
vi.mock('@/lib/system-alerts', () => ({
  insertSystemAlert: vi.fn().mockImplementation(async (a: any) => { raisedAlerts.push(a) }),
}))

process.env.APP_SECRET = 'test-secret'
process.env.WAHA_API_URL = 'http://waha.test'
process.env.WAHA_API_KEY = 'waha-key'

import { GET } from '@/app/api/cron/whatsapp-health/route'

function makeRequest(): any {
  return { headers: { get: (n: string) => (n.toLowerCase() === 'authorization' ? 'Bearer test-secret' : null) } } as any
}

beforeEach(() => {
  raisedAlerts = []
  resolvedAlertTypes = []
  mockActiveNumbers = []
  global.fetch = vi.fn().mockResolvedValue({ json: async () => ({ status: 'WORKING' }) })
})

describe('whatsapp-health — message-freshness watchdog', () => {
  it('raises a critical alert when no inbound message has arrived in over 4 hours, even though the WAHA session itself reports connected', async () => {
    mockLastInbound = { created_at: new Date(Date.now() - 25 * 3_600_000).toISOString() } // 25h ago — the real incident's magnitude

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.result.hoursSinceLastInbound).toBeGreaterThan(4)
    const alert = raisedAlerts.find(a => a.alert_type === 'whatsapp_no_inbound_traffic')
    expect(alert).toBeDefined()
    expect(alert.severity).toBe('critical')
  })

  it('does not alert when the last inbound message is recent', async () => {
    mockLastInbound = { created_at: new Date(Date.now() - 30 * 60_000).toISOString() } // 30 min ago

    await GET(makeRequest())

    expect(raisedAlerts.some(a => a.alert_type === 'whatsapp_no_inbound_traffic')).toBe(false)
  })

  it('does not alert (and has nothing to divide by zero on) when there has never been an inbound message at all', async () => {
    mockLastInbound = null

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.result.hoursSinceLastInbound).toBeNull()
    expect(raisedAlerts.some(a => a.alert_type === 'whatsapp_no_inbound_traffic')).toBe(false)
  })
})
