import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockModelContent = ''
let mockHistory: any[] = []
let mockCaseNote: string | null = null

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () { return {
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({
      choices: [{ message: { content: mockModelContent } }],
    })) } },
  } }),
}))

// Distinguishes by table name — 'debts' resolves via .maybeSingle() (the
// case-note fetch), 'messages' resolves via .order().limit() (the recent-
// history fetch). Both queries now run independently (see
// debt-status-classifier.ts), so the mock must support both chain shapes.
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockHistory, error: null }),
      maybeSingle: vi.fn().mockImplementation(async () => ({
        data: table === 'debts' ? { metadata: mockCaseNote ? { case_note: mockCaseNote } : {} } : null,
        error: null,
      })),
    })),
  })),
}))

import { classifyDebtOutcome } from '@/lib/debt-status-classifier'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test'
  mockModelContent = ''
  mockHistory = []
  mockCaseNote = null
})

describe('classifyDebtOutcome — conversation context', () => {
  it('works without debt_id exactly as before (no context fetch attempted)', async () => {
    mockModelContent = JSON.stringify({ category: 'العميل وعد بالسداد' })
    const result = await classifyDebtOutcome({ portfolio_name: 'موبايلي', customer_message: 'بسدد بكرة' })
    expect(result?.category).toBe('العميل وعد بالسداد')
  })

  it('still classifies a clear, definitive refusal correctly', async () => {
    mockModelContent = JSON.stringify({ category: 'العميل رافض السداد' })
    const result = await classifyDebtOutcome({
      portfolio_name: 'موبايلي', customer_message: 'ما راح اسدد المديونية نهائياً', debt_id: 'd1',
    })
    expect(result?.category).toBe('العميل رافض السداد')
  })

  // Regression for the real production misfire: a bare "لا" answering an
  // unrelated identity-confirmation question ("معي فلان؟") got classified as
  // "العميل رافض السداد" — with conversation context available, the model
  // should be able to tell this isn't about payment at all and return null.
  it('passes prior conversation context to the model so an ambiguous "لا" can be judged in context', async () => {
    mockHistory = [
      { direction: 'outbound', content: 'معي الأخ حذيفة؟', sent_at: '2026-07-01T10:00:00Z' },
    ]
    let capturedPrompt = ''
    mockModelContent = JSON.stringify({ category: null })
    const openaiModule = await import('openai')
    ;(openaiModule.default as any).mockImplementation(function () { return {
      chat: { completions: { create: vi.fn().mockImplementation(async (params: any) => {
        capturedPrompt = params.messages[1].content
        return { choices: [{ message: { content: mockModelContent } }] }
      }) } },
    } })

    const result = await classifyDebtOutcome({ portfolio_name: 'موبايلي', customer_message: 'لا', debt_id: 'd1' })

    expect(capturedPrompt).toContain('معي الأخ حذيفة؟')
    expect(capturedPrompt).toContain('سياق المحادثة')
    expect(result).toBeNull()
  })

  // Real production misfire this fixes: the opener message ("معي الأخ
  // فلان؟") is sent before any debt_id resolves, so it's stored with
  // debt_id=null — a plain debt_id filter permanently loses it once the
  // debt resolves. Confirmed live: a customer's bare "لا" (denying being
  // the target person) got classified as "العميل رافض السداد" because the
  // classifier never saw the question it was answering. customer_id lets
  // the query recover that orphaned opener.
  it('recovers a pre-resolution opener (debt_id=null) via customer_id so the ambiguous "لا" is judged in its real context', async () => {
    mockHistory = [
      { direction: 'outbound', content: 'معي الأخ يزيد؟', sent_at: '2026-07-01T07:20:00Z' },
    ]
    let capturedPrompt = ''
    mockModelContent = JSON.stringify({ category: null })
    const openaiModule = await import('openai')
    ;(openaiModule.default as any).mockImplementation(function () { return {
      chat: { completions: { create: vi.fn().mockImplementation(async (params: any) => {
        capturedPrompt = params.messages[1].content
        return { choices: [{ message: { content: mockModelContent } }] }
      }) } },
    } })

    const result = await classifyDebtOutcome({
      portfolio_name: 'موبايلي', customer_message: 'لا', debt_id: 'd1', customer_id: 'cust1',
    })

    expect(capturedPrompt).toContain('معي الأخ يزيد؟')
    expect(result).toBeNull()
  })

  // Real gap this fixes: classification only ever saw the last 8 raw
  // messages — something the customer said clearly earlier in a long
  // conversation and never repeated was invisible to every later call. The
  // running case note (already maintained on every real turn) now flows
  // into the same prompt so full-history facts aren't lost.
  it('includes the running case note as full-history context, independent of the recent-messages window', async () => {
    mockCaseNote = 'العميل طلب خطة تقسيط والوكيل رفعها للمراجعة، ولم يصله رد بعد.'
    mockHistory = []
    let capturedPrompt = ''
    mockModelContent = JSON.stringify({ category: null })
    const openaiModule = await import('openai')
    ;(openaiModule.default as any).mockImplementation(function () { return {
      chat: { completions: { create: vi.fn().mockImplementation(async (params: any) => {
        capturedPrompt = params.messages[1].content
        return { choices: [{ message: { content: mockModelContent } }] }
      }) } },
    } })

    await classifyDebtOutcome({ portfolio_name: 'موبايلي', customer_message: 'وش صار بطلبي', debt_id: 'd1' })

    expect(capturedPrompt).toContain('ملخص كامل المحادثة حتى الآن')
    expect(capturedPrompt).toContain('خطة تقسيط')
  })

  it('never throws and proceeds with the bare message if fetching context fails', async () => {
    const { createServiceClient } = await import('@/lib/supabase/server')
    ;(createServiceClient as any).mockImplementationOnce(() => ({
      from: () => { throw new Error('db unreachable') },
    }))
    mockModelContent = JSON.stringify({ category: 'العميل وعد بالسداد' })
    const result = await classifyDebtOutcome({ portfolio_name: 'موبايلي', customer_message: 'بسدد بكرة', debt_id: 'd1' })
    expect(result?.category).toBe('العميل وعد بالسداد')
  })
})
