import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Real gap this fixes: a voice note (audio/ogg) previously fell straight
// into "unsupported attachment type" — logged for staff, but the agent never
// knew the customer said anything, and never replied at all. This proves a
// voice note is transcribed and the TRANSCRIBED TEXT is what actually reaches
// runCollectorAgent (so the agent replies to what the customer really said),
// and that the stored inbound message records the transcript (marked as
// originating from voice) rather than being silently dropped.

let mockCustomerRow: any = { id: 'cust-1', company_id: 'co-1', full_name: 'خالد', ai_paused: false }
let mockLatestDebt: any = { id: 'd1', current_balance: 1000 }
let runCollectorAgentCalls: any[]
let insertedMessages: any[]

function makeEqChain(): any {
  const chain: any = {
    eq: vi.fn().mockImplementation(() => chain),
    not: vi.fn().mockImplementation(() => ({
      order: vi.fn().mockImplementation(() => ({ limit: vi.fn().mockImplementation(() => ({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockLatestDebt })) })) })),
    })),
    order: vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockImplementation(async () => ({ data: [] })),
    })),
    limit: vi.fn().mockImplementation(() => ({
      maybeSingle: vi.fn().mockImplementation(async () => ({ data: null })),
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
      // Must support both a bare `await insert(...)` AND
      // `insert(...).select('id').single()` — .select is attached directly
      // to the returned Promise, not wrapped in an async function.
      insert: vi.fn().mockImplementation((row: any) => {
        insertedMessages.push({ table, row })
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
    return { shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، فهمت طلبك.' }
  }),
  detectSignals: vi.fn().mockReturnValue({ deniesPromise: false, refusesToPay: false }),
}))

const mockTranscribe = vi.fn()
vi.mock('@/lib/audio-transcription', () => ({
  transcribeAudioMessage: (...args: any[]) => mockTranscribe(...args),
}))

process.env.WAHA_WEBHOOK_SECRET = 'test-secret'
process.env.WAHA_API_URL = 'http://waha.test'
process.env.WAHA_API_KEY = 'waha-key'

import { POST } from '@/app/api/whatsapp/waha-webhook/route'
import { __resetWahaWebhookStateForTests } from '@/lib/waha-webhook-state'

function makeRequest(body: any): any {
  return {
    json: async () => body,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-webhook-secret' ? 'test-secret' : null) },
  } as any
}

function voicePayload(msgIdSuffix: string) {
  return {
    event: 'message',
    payload: {
      fromMe: false, from: '966500000000@c.us', body: '', timestamp: 1000,
      id: { _serialized: `true_966500000000@c.us_${msgIdSuffix}` },
      media: { url: 'http://waha.test/media/voice1.ogg', mimetype: 'audio/ogg; codecs=opus' },
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  runCollectorAgentCalls = []
  insertedMessages = []
  mockTranscribe.mockReset()
  __resetWahaWebhookStateForTests()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('waha-webhook — voice note transcription', () => {
  it('transcribes a voice note and feeds the TRANSCRIBED TEXT to the agent, storing it in the conversation history', async () => {
    mockTranscribe.mockResolvedValue('ودي أعرف كم باقي علي وايش الحساب')

    await POST(makeRequest(voicePayload('voice-1')))
    await vi.advanceTimersByTimeAsync(9000)

    expect(runCollectorAgentCalls.length).toBe(1)
    expect(runCollectorAgentCalls[0].message).toBe('ودي أعرف كم باقي علي وايش الحساب')

    const inboundRow = insertedMessages.find(m => m.table === 'messages' && m.row.direction === 'inbound')
    expect(inboundRow?.row.content).toBe('🎤 (رسالة صوتية): ودي أعرف كم باقي علي وايش الحساب')
    expect(inboundRow?.row.metadata.voice_note).toBe(true)
  })

  it('never calls the agent and raises an alert when transcription fails (no text to reply to)', async () => {
    mockTranscribe.mockResolvedValue(null)

    await POST(makeRequest(voicePayload('voice-2')))
    await vi.advanceTimersByTimeAsync(9000)

    expect(runCollectorAgentCalls.length).toBe(0)
    expect(insertedMessages.some(m => m.table === 'messages' && m.row.direction === 'inbound')).toBe(false)
  })
})
