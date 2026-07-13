import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockModelContent = ''

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () { return {
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({
      choices: [{ message: { content: mockModelContent } }],
    })) } },
  } }),
}))

describe('document-classifier', () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    mockModelContent = ''
  })

  it('classifies a real receipt image and does NOT flag it for admin review (handled by the dedicated payment pipeline instead)', async () => {
    mockModelContent = JSON.stringify({ doc_type: 'receipt', summary: 'إيصال تحويل بنكي', confidence: 90 })
    const { classifyDocumentImage } = await import('@/lib/document-classifier')
    const result = await classifyDocumentImage('base64data')
    expect(result.doc_type).toBe('receipt')
    expect(result.needs_admin_review).toBe(false)
  })

  it('flags a debt-waiver document for mandatory admin review', async () => {
    mockModelContent = JSON.stringify({ doc_type: 'debt_waiver', summary: 'خطاب إسقاط مديونية', confidence: 80 })
    const { classifyDocumentImage } = await import('@/lib/document-classifier')
    const result = await classifyDocumentImage('base64data')
    expect(result.doc_type).toBe('debt_waiver')
    expect(result.needs_admin_review).toBe(true)
  })

  it('flags a court judgment for mandatory admin review', async () => {
    mockModelContent = JSON.stringify({ doc_type: 'court_judgment', summary: 'حكم محكمة', confidence: 85 })
    const { classifyDocumentImage } = await import('@/lib/document-classifier')
    const result = await classifyDocumentImage('base64data')
    expect(result.needs_admin_review).toBe(true)
  })

  it('does not require admin review for a plain ID document', async () => {
    mockModelContent = JSON.stringify({ doc_type: 'id_document', summary: 'صورة هوية وطنية', confidence: 95 })
    const { classifyDocumentImage } = await import('@/lib/document-classifier')
    const result = await classifyDocumentImage('base64data')
    expect(result.needs_admin_review).toBe(false)
  })

  // Closed-set enforcement — a hallucinated type outside the fixed list must
  // never propagate; falls back to 'other' (and therefore no auto-review
  // requirement) rather than crashing or trusting an invented category.
  it('discards a doc_type outside the closed list and falls back to "other"', async () => {
    mockModelContent = JSON.stringify({ doc_type: 'something_invented', summary: 'x', confidence: 50 })
    const { classifyDocumentImage } = await import('@/lib/document-classifier')
    const result = await classifyDocumentImage('base64data')
    expect(result.doc_type).toBe('other')
  })

  // Never silently assume anything when the model response is unusable —
  // must default to needing human review rather than guessing.
  it('malformed/empty model response falls back to "other" flagged for review', async () => {
    mockModelContent = 'not json at all'
    const { classifyDocumentImage } = await import('@/lib/document-classifier')
    const result = await classifyDocumentImage('base64data')
    expect(result.doc_type).toBe('other')
    expect(result.needs_admin_review).toBe(true)
  })

  it('returns a safe fallback (never throws) with no API key configured', async () => {
    delete process.env.OPENROUTER_API_KEY
    const { classifyDocumentImage } = await import('@/lib/document-classifier')
    const result = await classifyDocumentImage('base64data')
    expect(result.doc_type).toBe('other')
  })
})
