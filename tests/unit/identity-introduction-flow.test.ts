import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the Identity/Introduction Flow fix:
//   - first-ever "السلام عليكم" asks "معي الأخ/الأخت [الاسم]؟", never the ID.
//   - "انت مين؟" (reversed word order) is recognized and gets the fixed
//     self-introduction, never the ID request, in the same reply.
//   - the identity gate never fires before the agent has introduced itself
//     (no prior outbound message mentioning "خالد") at least once.
//   - once it does need to ask for the ID, it never repeats the exact same
//     wording twice in a row (pickUnusedVariant).

let mockModelContent = ''
let mockContext: any = {}

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({ choices: [{ message: { content: mockModelContent } }] })) } },
  })),
}))

vi.mock('@/lib/customer-debt-context', () => ({
  buildCustomerDebtContext: vi.fn().mockImplementation(async () => mockContext),
}))

vi.mock('@/lib/customer-context-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/customer-context-engine')
  return {
    ...actual,
    buildCustomer360Context: vi.fn().mockImplementation(async () => ({
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: null, portfolio_category: null, company_key: null, debts: [{ id: 'd1', status: 'active' }] }],
      allDisputes: [], customerDataByPortfolio: {},
    })),
  }
})

vi.mock('@/lib/company-playbook', async () => {
  const actual = await vi.importActual<any>('@/lib/company-playbook')
  return {
    ...actual,
    getPlaybookForPortfolio: vi.fn().mockImplementation(async () => ({
      portfolio_id: 'p1', category: 'other',
      discounts: { allowed: false, max_percent: 0, requires_admin_approval: true },
      installments: { allowed: false, max_months: 0, requires_admin_approval: true },
      fields_to_surface: [], allowed_dispute_types: [], notes: null,
      company_policy: null, ai_instructions: null, forbidden_phrases: [], escalation_rules: [], portfolio_specific_rules: null,
      is_default: true,
    })),
  }
})

vi.mock('@/lib/legal-escalation', async () => {
  const actual = await vi.importActual<any>('@/lib/legal-escalation')
  return { ...actual, getOpenEscalation: vi.fn().mockImplementation(async () => null), openEscalation: vi.fn().mockResolvedValue('esc-1') }
})

// Controls for the two things this fix actually reads from `customers`/`messages`:
let mockCustomerRow: any = {}
let mockHasIntroducedRow: { id: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'customers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockCustomerRow, error: null })) }),
          }),
          update: vi.fn().mockImplementation((patch: any) => {
            Object.assign(mockCustomerRow, patch)
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
        }
      }
      if (table === 'messages') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                ilike: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockImplementation(async () => ({ data: mockHasIntroducedRow, error: null })) }),
                }),
              }),
            }),
          }),
        }
      }
      // Any other table this flow doesn't care about — safe no-op shape.
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
      }
    }),
  })),
}))

import { runCollectorAgent } from '@/lib/ai-collector-agent'

function baseContext(overrides: Partial<any> = {}): any {
  return {
    verified_customer_data: { customer_name: 'محمد العتيبي' },
    verified_debt_data: { current_balance: 1000, currency: 'SAR', creditor_name: 'بنك الاختبار', reference_number: 'REF-1', status: 'active', portfolio_category: 'finance' },
    recent_messages: [], recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: {},
    ...overrides,
  }
}

function unverifiedRow(overrides: Partial<any> = {}) {
  return {
    verification_status: 'unverified', verification_attempts_count: 0,
    contact_opt_out: false, pending_clarification: null, national_id: '1234567890',
    used_reply_variants: {},
    ...overrides,
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockContext = baseContext()
  mockCustomerRow = unverifiedRow()
  mockHasIntroducedRow = null
})

describe('Identity / Introduction flow', () => {
  it('first-ever "السلام عليكم" asks to confirm the recipient by name — never the ID, never the debt', async () => {
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'السلام عليكم' })

    expect(d.reason).toBe('greeting_first_contact')
    expect(d.message).toContain('معي الأخ/الأخت محمد؟')
    expect(d.message).not.toMatch(/هويت|رقم هوية|إقامت/)
    expect(d.message).not.toMatch(/1,000|بنك الاختبار/)
  })

  it('"انت مين؟" (reversed word order) is recognized and self-introduces — no ID request mixed in', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_guess', message: 'مرحباً', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'انت مين؟' })

    expect(d.reason).toBe('self_introduction')
    expect(d.message).toMatch(/خالد/)
    expect(d.message).toMatch(/مصدر الرؤية/)
    expect(d.message).not.toMatch(/هويت|رقم هوية|إقامت/)
  })

  it('the identity gate never fires before the agent has introduced itself at least once', async () => {
    mockHasIntroducedRow = null // no prior outbound message mentions "خالد" yet
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'تمام', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'متى موعد السداد؟' })

    expect(d.reason).not.toBe('identity_verification_required')
    expect(d.message).not.toMatch(/هويت|رقم هوية|إقامت/)
  })

  it('once introduced, the gate DOES ask for the ID on an unrelated message with no 4-digit candidate', async () => {
    mockHasIntroducedRow = { id: 'intro-1' } // a prior outbound message already said "خالد"
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وليش اعطيك رقم هويتي؟' })

    expect(d.reason).toBe('identity_verification_required')
    expect(d.action).toBe('request_clarification')
    expect(d.message).toMatch(/هويت|إقامت/)
  })

  it('never repeats the exact same identity-request wording twice in a row', async () => {
    mockHasIntroducedRow = { id: 'intro-1' }
    const first = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وليش اعطيك رقم هويتي؟' })
    const second = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ما بعطيك شي' })

    expect(first.reason).toBe('identity_verification_required')
    expect(second.reason).toBe('identity_verification_required')
    expect(second.message).not.toBe(first.message)
  })
})
