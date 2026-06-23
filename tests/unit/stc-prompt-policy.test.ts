import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves, directly from the real runCollectorAgent execution (not a copy of
// the source text), that:
//   1. an STC operational-field question is classified INFO_REQUEST
//   2. the same question for a non-STC portfolio is UNCHANGED (still GENERAL)
//   3. the STC system prompt never contains "تصعيد قانوني" in any branch
//   4. a non-STC system prompt still contains it where it always did
//   5. a model reply that adds payment pressure to an STC field-meaning
//      answer gets stripped (because intent now correctly routes to
//      INFO_REQUEST, where guard (H) applies)

let mockModelContent = ''
let lastCreateCallMessages: any[] = []
let mockContext: any = {}
let mock360: any = null
let mockPlaybook: any = null

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: any) => {
          lastCreateCallMessages = params.messages
          return { choices: [{ message: { content: mockModelContent } }] }
        }),
      },
    },
  })),
}))

vi.mock('@/lib/customer-debt-context', () => ({
  buildCustomerDebtContext: vi.fn().mockImplementation(async () => mockContext),
}))

function singleDebtGroup() {
  return { debtGroups: [{ portfolio_id: 'p1', portfolio_name: null, portfolio_category: null, company_key: null, debts: [{ id: 'd1', status: 'active' }] }], allDisputes: [], customerDataByPortfolio: {} }
}

function defaultPlaybook(category = 'telecom') {
  return {
    portfolio_id: 'p1', category,
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
  return {
    ...actual,
    getPlaybookForPortfolio: vi.fn().mockImplementation(async () => mockPlaybook ?? defaultPlaybook()),
  }
})

const mockAlertInsert = vi.fn().mockResolvedValue({ data: null, error: null })
let mockCustomerGateRow: any = {
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
  return {
    ...actual,
    getOpenEscalation: vi.fn().mockImplementation(async () => null),
    openEscalation: vi.fn().mockResolvedValue('esc-1'),
  }
})

vi.mock('@/lib/customer-context-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/customer-context-engine')
  return {
    ...actual,
    buildCustomer360Context: vi.fn().mockImplementation(async () => mock360 ?? singleDebtGroup()),
  }
})

import { runCollectorAgent } from '@/lib/ai-collector-agent'

function baseContext(): any {
  return {
    verified_customer_data: { customer_name: 'فهد العتيبي' },
    verified_debt_data: {
      current_balance: 500, currency: 'SAR', creditor_name: null, portfolio_name: 'إس تي سي',
      reference_number: 'REF-1', status: 'overdue', portfolio_category: 'telecom',
    },
    recent_messages: [
      { direction: 'outbound', content: 'معك خالد بخصوص مديونية بقيمة 500 ريال.' },
      { direction: 'inbound', content: 'تمام' },
    ],
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: { metadata: {} },
  }
}

const INFO_REQUEST_MARKER = 'الرد المباشر على سؤال العميل من بيانات النظام'
const GENERAL_MARKER = 'متابعة عامة — استمرار وضغط'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockContext = baseContext()
  mock360 = { debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'إس تي سي', portfolio_category: 'telecom', company_key: 'stc', debts: [{ id: 'd1', status: 'overdue' }] }], allDisputes: [], customerDataByPortfolio: {} }
  mockPlaybook = defaultPlaybook('telecom')
  mockAlertInsert.mockClear()
  lastCreateCallMessages = []
  mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، رقم خدمتك هو 500111222.' })
})

describe('1) STC field-meaning question → INFO_REQUEST (was GENERAL before the fix)', () => {
  it('classifies "وش رقم الخدمة عندي؟" as INFO_REQUEST for the real STC portfolio name', async () => {
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش رقم الخدمة عندي؟' })
    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain(INFO_REQUEST_MARKER)
    expect(systemPrompt).not.toContain(GENERAL_MARKER)
  })
})

describe('2) the same question for a NON-STC portfolio is unaffected', () => {
  it('"وش رقم الخدمة عندي؟" still falls through to GENERAL for Mobily (telecom, not STC)', async () => {
    mockContext.verified_debt_data.portfolio_name = 'موبايلي'
    mock360 = { debtGroups: [{ portfolio_id: 'p2', portfolio_name: 'موبايلي', portfolio_category: 'telecom', company_key: 'mobily', debts: [{ id: 'd1', status: 'overdue' }] }], allDisputes: [], customerDataByPortfolio: {} }
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش رقم الخدمة عندي؟' })
    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain(GENERAL_MARKER)
    expect(systemPrompt).not.toContain(INFO_REQUEST_MARKER)
  })
})

describe('3) STC system prompt never contains "تصعيد قانوني"', () => {
  it('a DISPUTE-intent STC conversation prompt has zero mentions of "تصعيد قانوني"', async () => {
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'هذا الرقم غلط' })
    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).not.toContain('تصعيد قانوني')
  })

  it('an INFO_REQUEST-intent STC prompt (field-meaning question) also has zero mentions', async () => {
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش معنى تاريخ التعثر؟' })
    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).not.toContain('تصعيد قانوني')
  })
})

describe('4) non-STC system prompt is UNCHANGED — still contains "تصعيد قانوني" where it always did', () => {
  it('a DISPUTE-intent prompt for a non-STC portfolio still mentions "تصعيد قانوني"', async () => {
    mockContext.verified_debt_data.portfolio_name = 'موبايلي'
    mock360 = { debtGroups: [{ portfolio_id: 'p2', portfolio_name: 'موبايلي', portfolio_category: 'telecom', company_key: 'mobily', debts: [{ id: 'd1', status: 'overdue' }] }], allDisputes: [], customerDataByPortfolio: {} }
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'هذا الرقم غلط' })
    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain('تصعيد قانوني')
  })
})

describe('5) the final reply to an STC field-meaning question is polite/explanatory, not pressuring', () => {
  it('strips payment-pressure language the model tacked onto an STC field answer (guard H now applies because intent=INFO_REQUEST)', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'x',
      message: 'رقم خدمتك هو 500111222. والمهم بانتظار سدادك بأقرب وقت.',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش رقم الخدمة عندي؟' })
    expect(d.message).toContain('500111222')
    expect(d.message).not.toMatch(/بانتظار سدادك/)
  })
})
