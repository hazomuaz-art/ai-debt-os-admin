import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockModelContent = ''
let debtRow: any = { status: 'active', original_sub_status: null, metadata: {} }
let updateCalls: any[] = []

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({
      choices: [{ message: { content: mockModelContent } }],
    })) } },
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'debts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: debtRow, error: null }),
          update: vi.fn().mockImplementation((payload: any) => {
            updateCalls.push(payload)
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
        }
      }
      if (table === 'promises') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }
      }
      if (table === 'messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    }),
  })),
}))

import { updateCaseNote } from '@/lib/case-note'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test'
  debtRow = { status: 'active', original_sub_status: null, metadata: {} }
  updateCalls = []
  mockModelContent = ''
})

describe('updateCaseNote', () => {
  it('writes the note and recommendation into debts.metadata on success', async () => {
    mockModelContent = JSON.stringify({ note: 'العميل وعد بالسداد بداية الشهر القادم.', recommended_approach: 'تابع بعد 3 أيام من الموعد الموعود.' })
    await updateCaseNote({ company_id: 'c', debt_id: 'd1' })

    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0].metadata.case_note).toBe('العميل وعد بالسداد بداية الشهر القادم.')
    expect(updateCalls[0].metadata.recommended_approach).toBe('تابع بعد 3 أيام من الموعد الموعود.')
    expect(updateCalls[0].metadata.case_note_updated_at).toBeTruthy()
  })

  it('a malformed/empty LLM response leaves the debt untouched (no update call)', async () => {
    mockModelContent = 'not valid json at all'
    await updateCaseNote({ company_id: 'c', debt_id: 'd1' })
    expect(updateCalls.length).toBe(0)
  })

  it('never throws even when the debt cannot be found', async () => {
    debtRow = null
    await expect(updateCaseNote({ company_id: 'c', debt_id: 'missing' })).resolves.toBeUndefined()
    expect(updateCalls.length).toBe(0)
  })

  // Regression for the real production bug: a long/active conversation
  // produces a note long enough that the model's JSON response gets cut off
  // mid-string with no closing brace — confirmed live (a debt stuck on a
  // stale note for 14+ hours across 76 messages, "no usable note" logged on
  // every turn). The note field is written first and is usually intact even
  // when the response is truncated right after it — must still recover it.
  it('recovers the note from a truncated JSON response (no closing brace) instead of discarding it', async () => {
    mockModelContent = '{"note": "العميل وعد بالسداد يوم 27 من الشهر، وسبق أن تراجع عن وعد أول مرة قبل أن يؤكد مجدداً. الحالة نشطة ومتابَعة", "recommended_ap'
    await updateCaseNote({ company_id: 'c', debt_id: 'd1' })
    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0].metadata.case_note).toContain('وعد بالسداد يوم 27')
  })

  it('still discards a response with no recoverable note field at all', async () => {
    mockModelContent = '{"recommended_approach": "تابع بعد 3 أيام'
    await updateCaseNote({ company_id: 'c', debt_id: 'd1' })
    expect(updateCalls.length).toBe(0)
  })
})
