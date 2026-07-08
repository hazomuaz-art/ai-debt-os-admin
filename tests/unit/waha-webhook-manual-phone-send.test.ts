import { describe, it, expect, vi, beforeEach } from 'vitest'

// Real gap this fixes: a message sent manually from the LINKED PHONE itself
// (not through this system's dashboard) arrives as a webhook event with
// fromMe=true — this used to be unconditionally ignored, so the agent had
// zero knowledge such a message was ever sent to the customer, and could
// reply inconsistently with what staff already told them. Distinguishes a
// genuinely new manual send (never logged by us) from an echo of OUR OWN
// send (already logged via sendWhatsAppMessage, matched by
// whatsapp_message_id) — only the former gets recorded.

let insertedMessages: any[]
let existingOutboundIds: Set<string>
let mockCustomerRow: any = { id: 'cust-1', company_id: 'co-1' }
let mockDebtRow: any = { id: 'd1' }

function makeEqChain(table: string, forInsertMatch: boolean): any {
  const chain: any = {
    eq: vi.fn().mockImplementation(() => chain),
    not: vi.fn().mockImplementation(() => ({
      order: vi.fn().mockImplementation(() => ({ limit: vi.fn().mockImplementation(() => ({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockDebtRow })) })) })),
    })),
    limit: vi.fn().mockImplementation(() => ({
      maybeSingle: vi.fn().mockImplementation(async () => ({ data: forInsertMatch ? { id: 'existing-msg' } : null })),
    })),
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockImplementation(() => ({
        or: vi.fn().mockImplementation((filter: string) => {
          // The "already logged?" check on whatsapp_message_id
          if (table === 'messages' && filter.includes('whatsapp_message_id')) {
            const idMatch = filter.match(/whatsapp_message_id\.eq\.([^,]+)/)
            const id = idMatch?.[1]
            return makeEqChain(table, !!id && existingOutboundIds.has(id))
          }
          // Customer lookup by phone
          if (table === 'customers') {
            return { limit: vi.fn().mockImplementation(() => ({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockCustomerRow })) })) }
          }
          return makeEqChain(table, false)
        }),
        eq: vi.fn().mockImplementation(() => makeEqChain(table, false)),
      })),
      insert: vi.fn().mockImplementation(async (row: any) => {
        insertedMessages.push({ table, row })
        return { data: null, error: null }
      }),
    })),
  })),
}))

vi.mock('@/lib/whatsapp', () => ({
  normalizePhone: (p: string) => p.replace(/\D/g, ''),
  sendWhatsAppMessage: vi.fn().mockResolvedValue({ message_id: 'wam-1', status: 'sent' }),
}))
vi.mock('@/lib/payment-receipt', () => ({ processInboundReceipt: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/automation-pipeline', () => ({ processEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ai-collector-agent', () => ({
  runCollectorAgent: vi.fn(),
  detectSignals: vi.fn().mockReturnValue({ deniesPromise: false, refusesToPay: false }),
}))

process.env.WAHA_WEBHOOK_SECRET = 'test-secret'
process.env.WAHA_API_URL = 'http://waha.test'
process.env.WAHA_API_KEY = 'waha-key'

import { POST, __resetWahaWebhookStateForTests } from '@/app/api/whatsapp/waha-webhook/route'

function makeRequest(body: any): any {
  return {
    json: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-webhook-secret' ? 'test-secret' : null) },
  } as any
}

function fromMePayload(msgIdSuffix: string, body: string, to = '966500000000@c.us') {
  return {
    event: 'message',
    payload: {
      fromMe: true, to, from: '966561153262@c.us', body, timestamp: 1000,
      id: { _serialized: `true_966500000000@c.us_${msgIdSuffix}` },
    },
  }
}

beforeEach(() => {
  insertedMessages = []
  existingOutboundIds = new Set()
  __resetWahaWebhookStateForTests()
})

describe('waha-webhook — manual send from the linked phone (fromMe, not via our own API)', () => {
  it('records a NEW fromMe message (never logged by our own system) as an outbound message', async () => {
    await POST(makeRequest(fromMePayload('manual-1', 'تمام أرسل لك الإيصال بعدين')))

    const inserted = insertedMessages.find(m => m.table === 'messages')
    expect(inserted).toBeDefined()
    expect(inserted.row.direction).toBe('outbound')
    expect(inserted.row.content).toBe('تمام أرسل لك الإيصال بعدين')
    expect(inserted.row.customer_id).toBe('cust-1')
    expect(inserted.row.metadata.source).toBe('manual_phone_send')
  })

  it('does NOT re-record a fromMe event that is an echo of a message we already sent via our own system', async () => {
    const fullId = 'true_966500000000@c.us_already-sent'
    existingOutboundIds.add(fullId)
    existingOutboundIds.add('already-sent') // ref-only fallback form

    await POST(makeRequest(fromMePayload('already-sent', 'رسالة أرسلها الوكيل بنفسه')))

    expect(insertedMessages.some(m => m.table === 'messages')).toBe(false)
  })
})
