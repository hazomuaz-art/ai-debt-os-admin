import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression test for a real production double-reply (2026-07-06, customer
// 46700cf4): the webhook's duplicate-inbound guard was a SELECT-then-check
// with a real timing gap — if WAHA redelivers the same message event twice
// in quick succession (a known whatsapp-web.js/WAHA behavior), both
// requests can pass that SELECT before either commits its INSERT, so BOTH
// go on to run the agent and BOTH send a reply. Confirmed live: two
// different replies to what the customer experienced as one message, 24s
// apart. Fixed with a real DB-level partial unique index on
// (whatsapp_message_id) WHERE direction='inbound', and the webhook now
// treats the resulting 23505 (unique_violation) on the SECOND insert as a
// hard stop instead of "log and continue". This test proves that: two
// webhook deliveries for the same WAHA message id must produce at most one
// runCollectorAgent call, using the exact failure mode a real unique
// constraint produces — not just the earlier SELECT-based check (which the
// test suite already covers via mockDupRow in the burst-merge tests).

let mockCustomerRow: any = { id: 'cust-1', company_id: 'co-1', full_name: 'خالد', ai_paused: false }
let mockLatestDebt: any = { id: 'd1', current_balance: 1000 }
let insertedInboundMessageIds: Set<string>
let runCollectorAgentCalls: any[]

function makeEqChain(): any {
  const chain: any = {
    eq: vi.fn().mockImplementation(() => chain),
    not: vi.fn().mockImplementation(() => ({
      order: vi.fn().mockImplementation(() => ({ limit: vi.fn().mockImplementation(() => ({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockLatestDebt })) })) })),
    })),
    order: vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockImplementation(async () => ({ data: [] })), // no content-replay match
    })),
    limit: vi.fn().mockImplementation(() => ({
      maybeSingle: vi.fn().mockImplementation(async () => ({ data: null })), // no SELECT-based dup match — force the race down to the INSERT constraint
    })),
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockImplementation(() => ({
        or: vi.fn().mockImplementation(() => ({
          limit: vi.fn().mockImplementation(() => ({
            maybeSingle: vi.fn().mockImplementation(async () => ({ data: table === 'customers' ? mockCustomerRow : null })),
          })),
        })),
        eq: vi.fn().mockImplementation(() => makeEqChain()),
      })),
      // Same real-insert shape as waha-webhook-burst-merge.test.ts's mock:
      // must support both a bare `await insert(...)` AND
      // `insert(...).select('id').single()` — .select is attached directly
      // to the returned Promise, not wrapped in an async function.
      insert: vi.fn().mockImplementation((row: any) => {
        let result: { data: any; error: any }
        if (table !== 'messages' || row.direction !== 'inbound') {
          result = { data: { id: 'msg-mock-id' }, error: null }
        } else {
          const id = row.whatsapp_message_id
          if (id && insertedInboundMessageIds.has(id)) {
            result = { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_messages_inbound_whatsapp_message_id_unique"' } }
          } else {
            if (id) insertedInboundMessageIds.add(id)
            result = { data: { id: 'msg-mock-id' }, error: null }
          }
        }
        const p: any = Promise.resolve(result)
        p.select = () => ({ single: () => Promise.resolve(result) })
        return p
      }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    })),
  })),
}))

vi.mock('@/lib/whatsapp', () => ({
  normalizePhone: (p: string) => p,
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ message_id: 'wam-1', status: 'sent' }),
}))
vi.mock('@/lib/payment-receipt', () => ({ processInboundReceipt: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/automation-pipeline', () => ({ processEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/dispute', () => ({ recordDispute: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/promise', () => ({ recordPromise: vi.fn().mockResolvedValue(undefined), markOpenPromiseBroken: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ai-collector-agent', () => ({
  runCollectorAgent: vi.fn().mockImplementation(async (args: any) => {
    runCollectorAgentCalls.push(args)
    return { shouldReply: true, action: 'reply', reason: 'x', message: 'تمام.' }
  }),
  detectSignals: vi.fn().mockReturnValue({ deniesPromise: false, refusesToPay: false }),
}))

process.env.WAHA_WEBHOOK_SECRET = 'test-secret'

import { POST } from '@/app/api/whatsapp/waha-webhook/route'
import { __resetWahaWebhookStateForTests } from '@/lib/waha-webhook-state'

function makeRequest(body: any): any {
  return {
    json: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-webhook-secret' ? 'test-secret' : null) },
  } as any
}

function inboundPayload(text: string, msgIdSuffix: string, timestampSec: number) {
  return {
    event: 'message',
    payload: {
      fromMe: false, from: '966500000000@c.us', body: text, timestamp: timestampSec,
      id: { _serialized: `true_966500000000@c.us_${msgIdSuffix}` },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  insertedInboundMessageIds = new Set()
  runCollectorAgentCalls = []
  __resetWahaWebhookStateForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waha-webhook — DB-level inbound dedup blocks a redelivered WAHA event', () => {
  it('a redelivered webhook for the SAME message id runs the agent at most once', async () => {
    // Two separate POST requests for the exact same underlying WhatsApp
    // message (same msgId) — simulates WAHA firing both 'message' and
    // 'message.any' (or a network retry) for one real message. Each request
    // is a fully separate invocation (not concurrent within the same
    // process tick), so this specifically isolates the INSERT-level
    // constraint from the in-memory processingCustomers lock.
    await POST(makeRequest(inboundPayload('السلام عليكم', 'dup-1', 1000)))
    await vi.advanceTimersByTimeAsync(9000)
    await POST(makeRequest(inboundPayload('السلام عليكم', 'dup-1', 1000)))
    await vi.advanceTimersByTimeAsync(9000)

    expect(runCollectorAgentCalls.length).toBe(1)
  })
})
