import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Regression test for a real production incident (2026-07-10): a customer
// ("حذيفة") sent the same short greeting ("مساء الخير") several times over
// hours while re-testing the WhatsApp integration, each one a genuinely
// fresh message with WhatsApp's own current send timestamp. The
// content-based resync-replay guard in the webhook matched purely on text
// against the customer's last 5 inbound messages with no time bound, so
// every repeat after the first was silently dropped — never inserted, never
// answered, no visible error anywhere. It looked exactly like the webhook
// had stopped receiving messages entirely, even though WAHA was delivering
// every single one correctly. The guard must only treat a content match as
// a stale resync replay when the message's OWN WhatsApp timestamp is
// actually old — a fresh timestamp means it's a real new message and must
// never be dropped, no matter what it matches in history.

let mockCustomerRow: any = { id: 'cust-1', company_id: 'co-1', full_name: 'حذيفة', ai_paused: false }
let mockContentDupRow: any = null
let mockLatestDebt: any = { id: 'd1', current_balance: 1000 }
let runCollectorAgentCalls: any[] = []

function makeEqChain(): any {
  const chain: any = {
    eq: vi.fn().mockImplementation(() => chain),
    not: vi.fn().mockImplementation(() => ({
      order: vi.fn().mockImplementation(() => ({ limit: vi.fn().mockImplementation(() => ({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockLatestDebt })) })) })),
    })),
    order: vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockImplementation(async () => ({ data: mockContentDupRow ?? [] })),
    })),
    limit: vi.fn().mockImplementation(() => ({
      maybeSingle: vi.fn().mockImplementation(async () => ({ data: null })), // no msgId-level dup
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
      insert: vi.fn().mockImplementation(() => {
        const p: any = Promise.resolve({ data: { id: 'msg-mock-id' }, error: null })
        p.select = () => ({ single: () => Promise.resolve({ data: { id: 'msg-mock-id' }, error: null }) })
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

function inboundPayload(text: string, idSuffix: string, timestampSec: number) {
  return {
    event: 'message',
    payload: {
      fromMe: false, from: '966500000000@c.us', body: text, timestamp: timestampSec,
      id: { _serialized: `true_966500000000@c.us_${idSuffix}` },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  runCollectorAgentCalls = []
  mockContentDupRow = null
  __resetWahaWebhookStateForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waha-webhook — content-replay guard only fires on a genuinely stale timestamp', () => {
  it('a fresh message matching recent history text is still processed (not dropped as a replay)', async () => {
    const nowSec = Math.floor(Date.now() / 1000)
    mockContentDupRow = [{ content: 'مساء الخير' }]

    await POST(makeRequest(inboundPayload('مساء الخير', 'fresh-1', nowSec)))
    await vi.advanceTimersByTimeAsync(9000)

    expect(runCollectorAgentCalls.length).toBe(1)
  })

  it('a message carrying a stale (6+ minute old) WhatsApp timestamp matching recent history is still dropped as a resync replay', async () => {
    const staleSec = Math.floor(Date.now() / 1000) - 6 * 60
    mockContentDupRow = [{ content: 'مساء الخير' }]

    await POST(makeRequest(inboundPayload('مساء الخير', 'stale-1', staleSec)))
    await vi.advanceTimersByTimeAsync(9000)

    expect(runCollectorAgentCalls.length).toBe(0)
  })
})
