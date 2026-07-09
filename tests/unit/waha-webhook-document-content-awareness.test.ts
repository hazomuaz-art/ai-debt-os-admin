import { describe, it, expect, vi, beforeEach } from 'vitest'

// Real production bug this fixes (customer 057da61b, 2026-07-09): the
// document classifier already analyzes an attachment's ACTUAL content
// (classification.summary, via a vision-capable model) but that analysis
// was only ever written to a side table (customer_documents) and an admin
// alert — never into the conversation history itself. The stored inbound
// message stayed a permanently opaque "📎 إيصال (صورة)" placeholder, so any
// LATER turn's case-file/history read had zero idea what the attachment
// showed. Also, the immediate acknowledgment for a non-receipt/non-review
// attachment was a single fixed line ("استلمت المرفق، شكراً لك.") regardless
// of what the classifier found — the literal "just says thank you" pattern
// from the user's complaint.

let mockCustomerRow: any = { id: 'cust-1', company_id: 'co-1', full_name: 'خالد', ai_paused: false }
let mockLatestDebt: any = { id: 'd1', current_balance: 1000 }
let insertedMessages: any[]
let updatedMessages: any[]
let mockClassification: any
let mockRecentInboundForLang: { content: string | null }[] = []

function makeEqChain(): any {
  const chain: any = {
    eq: vi.fn().mockImplementation(() => chain),
    not: vi.fn().mockImplementation(() => ({
      order: vi.fn().mockImplementation(() => ({ limit: vi.fn().mockImplementation(() => ({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockLatestDebt })) })) })),
    })),
    order: vi.fn().mockImplementation(() => ({
      limit: vi.fn().mockImplementation(async () => ({ data: mockRecentInboundForLang })),
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
      insert: vi.fn().mockImplementation((row: any) => {
        insertedMessages.push({ table, row })
        const result = { data: { id: 'msg-mock-id' }, error: null }
        const p: any = Promise.resolve(result)
        p.select = () => ({ single: () => Promise.resolve(result) })
        return p
      }),
      update: vi.fn().mockImplementation((row: any) => ({
        eq: vi.fn().mockImplementation((col: string, val: any) => {
          updatedMessages.push({ table, row, col, val })
          return Promise.resolve({ data: null, error: null })
        }),
      })),
      storage: undefined,
    })),
    storage: { from: vi.fn().mockReturnValue({ upload: vi.fn().mockResolvedValue({ data: {}, error: null }) }) },
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
  runCollectorAgent: vi.fn().mockResolvedValue({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام.' }),
  detectSignals: vi.fn().mockReturnValue({ deniesPromise: false, refusesToPay: false }),
}))
vi.mock('@/lib/case-note', () => ({ updateCaseNote: vi.fn().mockResolvedValue(undefined) }))
let systemAlertCalls: any[] = []
vi.mock('@/lib/system-alerts', () => ({ insertSystemAlert: vi.fn().mockImplementation(async (a: any) => { systemAlertCalls.push(a) }) }))
vi.mock('@/lib/timeline', () => ({ insertTimelineEvent: vi.fn().mockResolvedValue(undefined) }))
let classifyDocumentImageCalls: any[] = []
vi.mock('@/lib/document-classifier', () => ({
  classifyDocumentImage: vi.fn().mockImplementation(async (...args: any[]) => { classifyDocumentImageCalls.push(args); return mockClassification }),
  classifyDocumentPdf: vi.fn().mockImplementation(async () => mockClassification),
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

function imagePayload(msgIdSuffix: string) {
  return {
    event: 'message',
    payload: {
      fromMe: false, from: '966500000000@c.us', body: '', timestamp: 1000,
      id: { _serialized: `true_966500000000@c.us_${msgIdSuffix}` },
      media: { url: 'http://waha.test/media/photo1.jpg', mimetype: 'image/jpeg' },
    },
  }
}

async function flush() {
  // The document-classification IIFE is fire-and-forget (webhook responds to
  // WAHA before it finishes) — give its awaited chain (fetch → classify →
  // storage → inserts) real event-loop turns to complete.
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0))
}

beforeEach(() => {
  insertedMessages = []
  updatedMessages = []
  mockRecentInboundForLang = []
  classifyDocumentImageCalls = []
  systemAlertCalls = []
  __resetWahaWebhookStateForTests()
  global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
})

describe('waha-webhook — document content awareness', () => {
  it('enriches the stored inbound message with the classifier\'s real content analysis, not an opaque placeholder', async () => {
    mockClassification = { doc_type: 'other', summary: 'صورة لطلب عدم ملكية مقدّم لشركة موبايلي', confidence: 80, needs_admin_review: false }

    await POST(makeRequest(imagePayload('img-1')))
    await flush()

    const updatedInbound = updatedMessages.find(m => m.table === 'messages' && m.val === 'msg-mock-id')
    expect(updatedInbound?.row.content).toContain('صورة لطلب عدم ملكية مقدّم لشركة موبايلي')
  })

  it('the immediate acknowledgment references the real content instead of a blind generic line', async () => {
    mockClassification = { doc_type: 'other', summary: 'كشف حساب بنكي غير رسمي', confidence: 70, needs_admin_review: false }

    await POST(makeRequest(imagePayload('img-2')))
    await flush()

    const ack = insertedMessages.find(m => m.table === 'messages' && m.row.direction === 'outbound' && m.row.metadata?.action_type === 'document_ack')
    expect(ack?.row.content).toContain('كشف حساب بنكي غير رسمي')
    expect(ack?.row.content).not.toBe('استلمت المرفق، شكراً لك.')
  })

  it('falls back to the generic line when the classifier found nothing to describe (empty summary)', async () => {
    mockClassification = { doc_type: 'other', summary: '', confidence: 0, needs_admin_review: false }

    await POST(makeRequest(imagePayload('img-3')))
    await flush()

    const ack = insertedMessages.find(m => m.table === 'messages' && m.row.direction === 'outbound' && m.row.metadata?.action_type === 'document_ack')
    expect(ack?.row.content).toBe('استلمت المرفق، شكراً لك.')
  })

  it('never wraps the summary in a stilted "(...)."  parenthetical — real incident, customer 4a47f571, 2026-07-09', async () => {
    // Exact production bug: the old template was
    // `تم استلام مرفقك (${summary}). إذا له علاقة...` — for a real classifier
    // summary written in analytical third-person style, this produced:
    //   'تم استلام مرفقك (صورة خارجية لمبنى ومحل خاص بشركة موبايلي (اتصالات)،
    //    لا تحتوي على مستند أو إيصال متعلق بالديون.). إذا له علاقة بموضوع
    //    مديونيتك وضّح لي كيف أقدر أساعدك فيه.'
    // — nested nonsensical punctuation that reads like a bolted-on analysis
    // report, not a message a human collector would send. The summary must
    // flow directly into the sentence, never be parenthesized.
    mockClassification = {
      doc_type: 'other',
      summary: 'صورة خارجية لمبنى ومحل خاص بشركة موبايلي، ما فيها أي مستند متعلق بالدين.',
      confidence: 60, needs_admin_review: false,
    }

    await POST(makeRequest(imagePayload('img-4')))
    await flush()

    const ack = insertedMessages.find(m => m.table === 'messages' && m.row.direction === 'outbound' && m.row.metadata?.action_type === 'document_ack')
    expect(ack?.row.content).not.toMatch(/\(.*\)\./)
    expect(ack?.row.content).toBe('صورة خارجية لمبنى ومحل خاص بشركة موبايلي، ما فيها أي مستند متعلق بالدين. إذا له علاقة بموضوع مديونيتك وضّح لي كيف أقدر أساعدك فيه.')
  })

  it('replies in English for a customer whose real conversation is in English — real incident, customer RAYMOND LASTRELLA BLANCAFLOR / 4a47f571, 2026-07-09', async () => {
    // Exact production bug: this customer's entire conversation (dozens of
    // turns) was in English, and the main collector agent already mirrored
    // that correctly per-message — but this separate document-ack path never
    // looked at conversation language at all, so it replied in Arabic to an
    // attachment even though the customer had never once used Arabic:
    //   'تم استلام مرفقك (...). إذا له علاقة بموضوع مديونيتك...'
    // to a customer who writes "Ok", "Better I check with Mobily office
    // tomorrow morning", etc. An attachment usually has no caption of its
    // own to judge, so this must look at the customer's actual recent
    // messages, not just the current (empty) one.
    mockRecentInboundForLang = [
      { content: 'Better I check with Mobily office tomorrow morning' },
      { content: 'Can you check the phone number of this bill? Please' },
      { content: 'I want to pay in installments' },
      { content: 'Ok' },
    ]
    mockClassification = { doc_type: 'other', summary: 'A photo of a building and shop belonging to Mobily, no debt-related document in it.', confidence: 60, needs_admin_review: false }

    await POST(makeRequest(imagePayload('img-5')))
    await flush()

    expect(classifyDocumentImageCalls[0]?.[1]).toBe('en')
    const ack = insertedMessages.find(m => m.table === 'messages' && m.row.direction === 'outbound' && m.row.metadata?.action_type === 'document_ack')
    expect(ack?.row.content).toBe('A photo of a building and shop belonging to Mobily, no debt-related document in it. If this is related to your debt, let me know how I can help.')
    expect(ack?.row.content).not.toMatch(/[؀-ۿ]/) // no Arabic script at all
  })

  it('stays in Arabic when the classifier found nothing AND the conversation is genuinely Arabic', async () => {
    mockRecentInboundForLang = [{ content: 'وش الوضع' }, { content: 'ابغى اتأكد من المبلغ' }]
    mockClassification = { doc_type: 'other', summary: '', confidence: 0, needs_admin_review: false }

    await POST(makeRequest(imagePayload('img-6')))
    await flush()

    expect(classifyDocumentImageCalls[0]?.[1]).toBe('ar')
    const ack = insertedMessages.find(m => m.table === 'messages' && m.row.direction === 'outbound' && m.row.metadata?.action_type === 'document_ack')
    expect(ack?.row.content).toBe('استلمت المرفق، شكراً لك.')
  })

  it('never silently drops a receipt when the media download fails — notifies the customer AND raises an admin alert (real incident, customer RAYMOND LASTRELLA BLANCAFLOR / 4a47f571, 2026-07-09)', async () => {
    // Exact production bug: this customer sent a real 100 SAR payment
    // receipt (PDF) that vanished entirely — no customer_documents row, no
    // reply of any kind, no admin alert. Root cause was
    // `if (!r.ok) { log.error(...); return }` on the WAHA media download:
    // a server-side log line only, dead silence to everyone else. The
    // customer's actual partial payment was never recorded or even noticed.
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 502, arrayBuffer: async () => new Uint8Array().buffer })
    mockRecentInboundForLang = [{ content: 'Ok i will put money then I pay' }, { content: 'Account number?' }]

    await POST(makeRequest(imagePayload('img-7')))
    await flush()

    // Customer must be told, not left in silence.
    const failureAck = insertedMessages.find(m => m.table === 'messages' && m.row.direction === 'outbound' && m.row.metadata?.source === 'document_processing_failed')
    expect(failureAck).toBeDefined()
    expect(failureAck?.row.content).toMatch(/resend/i)
    // Admin must be alerted a document was lost, not just a server log line.
    expect(systemAlertCalls.some(a => a.alert_type === 'document_processing_failed')).toBe(true)
  })
})
