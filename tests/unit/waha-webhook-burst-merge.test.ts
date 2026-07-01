import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Proves the fix for a REAL production pattern: a customer sends 2-3
// WhatsApp messages within seconds of each other ("ماوعدتك انا بشي" then
// "انت تستهبل؟"), and the agent previously replied to each one independently
// — generating two separate, sometimes contradictory replies because the
// reply to message 1 was already in flight before message 2 even arrived.
// The webhook now debounces/merges a rapid-fire burst per customer into ONE
// combined message before a single runCollectorAgent call.

let mockCustomerRow: any = { id: 'cust-1', company_id: 'co-1', full_name: 'حذيفه', ai_paused: false }
let mockDupRow: any = null
let mockContentDupRow: any = null
let mockLatestDebt: any = { id: 'd1', current_balance: 1000 }
let runCollectorAgentCalls: any[] = []
let mockAiDecision: any = { shouldReply: true, action: 'reply', reason: 'x', message: 'تمام.' }

// A chainable query-builder mock: any sequence of .eq()/.not()/.order() calls
// is supported (each just returns the same chain object), terminated by
// either .limit().maybeSingle() (single-row dup checks), .not().order()
// .limit().maybeSingle() (latest-debt lookup), or a direct .order().limit()
// with NO .maybeSingle() (the resync-replay content check, which pulls the
// customer's last 5 inbound rows as an array). The replay check resolves to
// mockContentDupRow (an array of recent inbound contents, default empty —
// i.e. no replay detected); the single-row dup checks resolve to mockDupRow.
function makeEqChain(table: string, isMessagesInboundQuery: boolean): any {
  const chain: any = {
    eq: vi.fn().mockImplementation((col: string) => makeEqChain(table, isMessagesInboundQuery || col === 'direction')),
    not: vi.fn().mockImplementation(() => ({
      order: vi.fn().mockImplementation(() => ({ limit: vi.fn().mockImplementation(() => ({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockLatestDebt })) })) })),
    })),
    order: vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockImplementation(async () => ({ data: mockContentDupRow ?? [] })),
    })),
    limit: vi.fn().mockImplementation(() => ({
      maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockDupRow })),
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
            maybeSingle: vi.fn().mockImplementation(async () => ({
              data: table === 'customers' ? mockCustomerRow : null,
            })),
          })),
        })),
        eq: vi.fn().mockImplementation((col: string) => makeEqChain(table, col === 'direction')),
      })),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
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
vi.mock('@/lib/promise', () => ({
  recordPromise: vi.fn().mockResolvedValue(undefined),
  markOpenPromiseBroken: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai-collector-agent', () => ({
  runCollectorAgent: vi.fn().mockImplementation(async (args: any) => {
    runCollectorAgentCalls.push(args)
    return mockAiDecision
  }),
  detectSignals: vi.fn().mockReturnValue({ deniesPromise: false, refusesToPay: false }),
}))

import { POST } from '@/app/api/whatsapp/waha-webhook/route'

function makeRequest(body: any): any {
  return { json: async () => body } as any
}

function inboundPayload(text: string, idSuffix: string, timestampSec: number) {
  return {
    event: 'message',
    payload: {
      fromMe: false,
      from: '966500000000@c.us',
      body: text,
      timestamp: timestampSec,
      id: { _serialized: `true_966500000000@c.us_${idSuffix}` },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  runCollectorAgentCalls = []
  mockDupRow = null
  mockAiDecision = { shouldReply: true, action: 'reply', reason: 'x', message: 'تمام.' }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Rapid-fire message burst merging', () => {
  it('two messages sent 2 seconds apart are merged into ONE runCollectorAgent call', async () => {
    await POST(makeRequest(inboundPayload('ماوعدتك انا بشي', 'm1', 1000)))
    await vi.advanceTimersByTimeAsync(2000)
    await POST(makeRequest(inboundPayload('انت تستهبل؟', 'm2', 1002)))
    await vi.advanceTimersByTimeAsync(6000)

    expect(runCollectorAgentCalls.length).toBe(1)
    expect(runCollectorAgentCalls[0].message).toBe('ماوعدتك انا بشي\nانت تستهبل؟')
  })

  it('a single message with no follow-up still gets processed after the debounce window', async () => {
    await POST(makeRequest(inboundPayload('وش صار في موضوعي', 'm3', 2000)))
    await vi.advanceTimersByTimeAsync(6000)

    expect(runCollectorAgentCalls.length).toBe(1)
    expect(runCollectorAgentCalls[0].message).toBe('وش صار في موضوعي')
  })

  it('three rapid messages all merge into one call, in order', async () => {
    await POST(makeRequest(inboundPayload('بسدد اقساط', 'm4', 3000)))
    await vi.advanceTimersByTimeAsync(1000)
    await POST(makeRequest(inboundPayload('اي طلب؟', 'm5', 3001)))
    await vi.advanceTimersByTimeAsync(1000)
    await POST(makeRequest(inboundPayload('يعني ايش الخطوة الجاية', 'm6', 3002)))
    await vi.advanceTimersByTimeAsync(6000)

    expect(runCollectorAgentCalls.length).toBe(1)
    expect(runCollectorAgentCalls[0].message).toBe('بسدد اقساط\nاي طلب؟\nيعني ايش الخطوة الجاية')
  })

  it('messages from two DIFFERENT customers never get merged together', async () => {
    mockCustomerRow = { id: 'cust-1', company_id: 'co-1', full_name: 'حذيفه', ai_paused: false }
    await POST(makeRequest(inboundPayload('رسالة من عميل واحد', 'm7', 4000)))
    mockCustomerRow = { id: 'cust-2', company_id: 'co-1', full_name: 'سعد', ai_paused: false }
    await POST(makeRequest({ ...inboundPayload('رسالة من عميل ثاني', 'm8', 4001), payload: { ...inboundPayload('رسالة من عميل ثاني', 'm8', 4001).payload, from: '966511111111@c.us' } }))
    await vi.advanceTimersByTimeAsync(6000)

    expect(runCollectorAgentCalls.length).toBe(2)
    expect(runCollectorAgentCalls.map(c => c.customer_id).sort()).toEqual(['cust-1', 'cust-2'])
  })
})
