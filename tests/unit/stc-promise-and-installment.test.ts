import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the 4 approved fixes (أ/ب/ج/د) for the STC promise/installment bug:
//   أ) STC's NEGOTIATION prompt bans the agent from proposing installments —
//      only a customer-INITIATED request gets recorded for review.
//   ب) an explicit temporal reference in the customer's CURRENT message
//      (بداية الشهر, etc.) forces action=record_promise even if the model
//      chose 'negotiate' instead.
//   ج) the forced promise produces a confirmation reply, never a re-ask of
//      "متى تسدد؟".
//   د) repeated_question_guard / anti_repetition_guard (now widened to
//      'negotiate') never inject a payment-date question once a promise
//      exists (on file or just force-recorded this turn).
// Also proves Mobily's installmentRule is completely unaffected.

let mockModelContent = ''
let lastCreateCallMessages: any[] = []
let mockContext: any = {}
let mockPlaybook: any = null

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () { return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: any) => {
          if (params.messages?.[0]?.role === 'system') lastCreateCallMessages = params.messages
          return { choices: [{ message: { content: mockModelContent } }] }
        }),
      },
    },
  } }),
}))

vi.mock('@/lib/customer-debt-context', () => ({
  buildCustomerDebtContext: vi.fn().mockImplementation(async () => mockContext),
}))

function defaultPlaybook() {
  return {
    portfolio_id: 'p1', category: 'telecom',
    discounts: { allowed: false, max_percent: 0, requires_admin_approval: true },
    installments: { allowed: false, max_months: 0, requires_admin_approval: true },
    fields_to_surface: ['account_number', 'reference_number'],
    allowed_dispute_types: ['wrong_number', 'not_mine', 'already_settled'],
    notes: null,
    company_policy: null, ai_instructions: null, forbidden_phrases: [], escalation_rules: [], portfolio_specific_rules: null,
    is_default: true,
  }
}
vi.mock('@/lib/company-playbook', async () => {
  const actual = await vi.importActual<any>('@/lib/company-playbook')
  return { ...actual, getPlaybookForPortfolio: vi.fn().mockImplementation(async () => mockPlaybook ?? defaultPlaybook()) }
})

const mockAlertInsert = vi.fn().mockResolvedValue({ data: null, error: null })
const mockCustomerGateRow: any = {
  verification_status: 'verified', verification_attempts_count: 0,
  contact_opt_out: false, pending_clarification: null, national_id: null,
  used_reply_variants: {},
}
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      insert: mockAlertInsert,
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: table === 'customers' ? mockCustomerGateRow : null, error: null }),
        }),
      }),
    })),
  })),
}))

vi.mock('@/lib/legal-escalation', async () => {
  const actual = await vi.importActual<any>('@/lib/legal-escalation')
  return { ...actual, getOpenEscalation: vi.fn().mockImplementation(async () => null), openEscalation: vi.fn().mockResolvedValue('esc-1') }
})

vi.mock('@/lib/customer-context-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/customer-context-engine')
  return {
    ...actual,
    buildCustomer360Context: vi.fn().mockImplementation(async () => ({
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'إس تي سي', portfolio_category: 'telecom', company_key: 'stc', debts: [{ id: 'd1', status: 'overdue' }] }],
      allDisputes: [], customerDataByPortfolio: {},
    })),
  }
})

import { runCollectorAgent } from '@/lib/ai-collector-agent'

function stcContext(overrides: Partial<any> = {}): any {
  return {
    verified_customer_data: { customer_name: 'محمد العتيبي' },
    verified_debt_data: {
      current_balance: 1000, currency: 'SAR', creditor_name: null, portfolio_name: 'إس تي سي',
      reference_number: 'REF-9', status: 'overdue', portfolio_category: 'telecom',
    },
    recent_messages: [
      { direction: 'outbound', content: 'معك خالد بخصوص مديونية بقيمة 1000 ريال لصالح STC.' },
      { direction: 'inbound', content: 'ألف ريال إذا حصلت' },
    ],
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: { metadata: {} },
    ...overrides,
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockContext = stcContext()
  mockPlaybook = defaultPlaybook()
  mockAlertInsert.mockClear()
  lastCreateCallMessages = []
})

describe('ب/ج) explicit temporal reference forces record_promise and a confirmation reply', () => {
  it('"قلت لك بداية الشهر" → record_promise, not negotiate; no re-ask', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'model_missed_it',
      message: 'متى تقدر تسدد؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'قلت لك بداية الشهر' })

    expect(d.action).toBe('record_promise')
    expect(d.reason).toBe('promise_forced_from_temporal_ref')
    expect(d.message).not.toMatch(/متى تقدر تسدد|متى تسدد/)
    expect(d.promised_date).toBeTruthy()
  })

  it('"بداية الشهر بسدد ألف" → records a promise, never asks "متى تسدد؟"', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'model_missed_it',
      message: 'وش رايك نرتب موعد سداد واضح؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بداية الشهر بسدد ألف' })

    expect(d.action).toBe('record_promise')
    expect(d.message).not.toMatch(/متى تسدد|موعد سداد واضح/)
    expect(d.promised_date).toBeTruthy()
  })
})

describe('أ) STC never proposes installments on its own', () => {
  it('the NEGOTIATION prompt for STC bans proposing installments and only allows recording a customer-initiated request', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'تمام، متى تقدر تسدد؟' })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ما عندي المبلغ كامل الحين' })

    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain('ممنوع منعاً باتاً أن تقترح أو تذكر التقسيط ابتداءً')
    expect(systemPrompt).not.toMatch(/إن أصرّ فعلاً على التقسيط بعد محاولتك/)
  })

  it('Mobily (non-STC) now bans proactively proposing installments too — the ban is universal, not STC-only', async () => {
    mockContext.verified_debt_data.portfolio_name = 'موبايلي'
    const customerContextEngine = await import('@/lib/customer-context-engine')
    ;(customerContextEngine.buildCustomer360Context as any).mockResolvedValueOnce({
      debtGroups: [{ portfolio_id: 'p2', portfolio_name: 'موبايلي', portfolio_category: 'telecom', company_key: 'mobily', debts: [{ id: 'd1', status: 'overdue' }] }],
      allDisputes: [], customerDataByPortfolio: {},
    })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'تمام، متى تقدر تسدد؟' })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ما عندي المبلغ كامل الحين' })

    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain('ممنوع منعاً باتاً أن تقترح أو تذكر التقسيط ابتداءً')
    expect(systemPrompt).toContain('فقط إذا طلب العميل التقسيط بنفسه وبشكل صريح')
  })
})

describe('أ) explicit customer-initiated installment request in STC → review only, no approval', () => {
  it('passes through record_installment_request as the model produced it, with the no-self-approval instruction present in the prompt', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_installment_request', reason: 'customer_asked',
      message: 'أقدر أرفع طلبك للمراجعة، وإذا تمت الموافقة يتم إفادتك.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'أبغى أسوي تقسيط للدين' })

    expect(d.action).toBe('record_installment_request')
    expect(d.message).not.toMatch(/\d+\s*(شهر|دفعات|قسط)/) // no fabricated schedule
    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain('دون وعد بالموافقة')
  })
})

describe('د) repeated_question_guard / anti_repetition_guard never re-ask the date once a promise exists', () => {
  it('an existing pending promise blocks a repeated date-question fallback even under action=negotiate', async () => {
    mockContext.recent_promises = [{ status: 'pending', promised_amount: 1000, promised_date: '2026-07-01' }]
    mockContext.recent_messages.push({ direction: 'outbound', content: 'تمام، متى تقدر تسدد المبلغ بالضبط؟' })
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'x', message: 'طيب، متى بالضبط تقدر تسدد المبلغ؟',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'طيب بشوف وضعي' })

    expect(d.message).not.toMatch(/متى.*تسدد/)
    expect(d.message).toContain('2026-07-01')
  })
})
