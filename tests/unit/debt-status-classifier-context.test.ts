import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockModelContent = ''
let mockHistory: any[] = []

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({
      choices: [{ message: { content: mockModelContent } }],
    })) } },
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: mockHistory, error: null }),
    })),
  })),
}))

import { classifyDebtOutcome } from '@/lib/debt-status-classifier'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test'
  mockModelContent = ''
  mockHistory = []
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
    ;(openaiModule.default as any).mockImplementation(() => ({
      chat: { completions: { create: vi.fn().mockImplementation(async (params: any) => {
        capturedPrompt = params.messages[1].content
        return { choices: [{ message: { content: mockModelContent } }] }
      }) } },
    }))

    const result = await classifyDebtOutcome({ portfolio_name: 'موبايلي', customer_message: 'لا', debt_id: 'd1' })

    expect(capturedPrompt).toContain('معي الأخ حذيفة؟')
    expect(capturedPrompt).toContain('سياق المحادثة')
    expect(result).toBeNull()
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
