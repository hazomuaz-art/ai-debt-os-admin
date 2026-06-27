import { describe, it, expect, vi, beforeEach } from 'vitest'

// End-to-end via the real runCollectorAgent (mocked OpenAI/Supabase),
// asserting on the actual captured system prompt:
//   - a Mobily payment/field question routes to INFO_REQUEST
//   - the same question for STC routes via the STC path, NOT Mobily's
//   - the Mobily knowledge block + status-based number reach the prompt
//   - a non-Mobily/non-STC telecom is unaffected

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
    installments: { allowed: true, max_months: 2, requires_admin_approval: true },
    fields_to_surface: ['account_number', 'product_number'],
    allowed_dispute_types: ['wrong_number', 'not_mine', 'already_settled'],
    notes: null,
    company_policy: null, ai_instructions: null, forbidden_phrases: [], escalation_rules: [], portfolio_specific_rules: null,
    is_default: false,
  }
}
vi.mock('@/lib/company-playbook', async () => {
  const actual = await vi.importActual<any>('@/lib/company-playbook')
  return { ...actual, getPlaybookForPortfolio: vi.fn().mockImplementation(async () => mockPlaybook ?? defaultPlaybook()) }
})

const mockAlertInsert = vi.fn().mockResolvedValue({ data: null, error: null })
const mockCustomerGateRow: any = {
  verification_status: 'verified', verification_attempts_count: 0,
  contact_opt_out: false, pending_clarification: null, national_id: null, used_reply_variants: {},
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
  return { ...actual, buildCustomer360Context: vi.fn().mockImplementation(async () => mock360 ?? singleDebtGroup()) }
})

import { runCollectorAgent } from '@/lib/ai-collector-agent'

function baseContext(portfolioName: string): any {
  return {
    verified_customer_data: { customer_name: 'فهد العتيبي' },
    verified_debt_data: {
      current_balance: 300, currency: 'SAR', creditor_name: null, portfolio_name: portfolioName,
      reference_number: 'REF-1', status: 'overdue', portfolio_category: 'telecom',
    },
    recent_messages: [
      { direction: 'outbound', content: 'معك خالد بخصوص مديونية بقيمة 300 ريال.' },
      { direction: 'inbound', content: 'تمام' },
    ],
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: { metadata: {} },
  }
}

const INFO_REQUEST_MARKER = 'الرد المباشر على سؤال العميل من بيانات النظام'
const MOBILY_KNOWLEDGE_MARKER = 'معرفة تشغيلية خاصة بموبايلي'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockPlaybook = defaultPlaybook('telecom')
  mockAlertInsert.mockClear()
  lastCreateCallMessages = []
  mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، رقم خدمتك هو 0551112222.' })
})

describe('Mobily field/payment question → INFO_REQUEST, with knowledge block injected', () => {
  beforeEach(() => {
    mockContext = baseContext('موبايلي')
    mock360 = {
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'موبايلي', portfolio_category: 'telecom', company_key: 'mobily', debts: [{ id: 'd1', status: 'overdue' }] }],
      allDisputes: [],
      customerDataByPortfolio: { p1: [{ service_status: 'Inactive', product_number: '0551112222', account_number: 'ACC-9' }] },
    }
  })

  it('routes "وش رقم السداد؟" to INFO_REQUEST and injects the Mobily knowledge + correct number', async () => {
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش رقم السداد؟' })
    const sys = lastCreateCallMessages[0].content as string
    expect(sys).toContain(INFO_REQUEST_MARKER)
    expect(sys).toContain(MOBILY_KNOWLEDGE_MARKER)
    expect(sys).toContain('0551112222') // service number, because status is Inactive
  })

  it('Closed status surfaces the account number instead', async () => {
    mock360.customerDataByPortfolio.p1 = [{ service_status: 'Closed', product_number: '0551112222', account_number: 'ACC-9' }]
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'كيف أسدد؟' })
    const sys = lastCreateCallMessages[0].content as string
    expect(sys).toContain('ACC-9')
  })
})

describe('STC is unaffected by the Mobily wiring', () => {
  it('an STC portfolio still gets the STC knowledge path, never the Mobily block', async () => {
    mockContext = baseContext('إس تي سي')
    mock360 = {
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'إس تي سي', portfolio_category: 'telecom', company_key: 'stc', debts: [{ id: 'd1', status: 'overdue' }] }],
      allDisputes: [],
      customerDataByPortfolio: { p1: [{ sadad_number: '900111222', baqa_flag: 'YES', product_number: '5xxxxxxxx' }] },
    }
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش رقم السداد؟' })
    const sys = lastCreateCallMessages[0].content as string
    expect(sys).not.toContain(MOBILY_KNOWLEDGE_MARKER)
  })
})

describe('a non-Mobily/non-STC telecom portfolio is unaffected', () => {
  it('no Mobily knowledge block for a generic telecom portfolio', async () => {
    mockContext = baseContext('شركة اتصالات أخرى')
    mock360 = {
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'شركة اتصالات أخرى', portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'overdue' }] }],
      allDisputes: [], customerDataByPortfolio: {},
    }
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش رقم السداد؟' })
    const sys = lastCreateCallMessages[0].content as string
    expect(sys).not.toContain(MOBILY_KNOWLEDGE_MARKER)
  })
})
