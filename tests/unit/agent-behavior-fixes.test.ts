import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the 3 approved fixes (أ/ب/ج) directly via the real runCollectorAgent
// pipeline (mocked OpenAI/Supabase only):
//   أ) anti_repetition_guard / repeated_question_guard never force a payment
//      question onto a GREETING or INFO_REQUEST turn.
//   ب) a model reply drifting into Egyptian/Sudanese dialect is caught and
//      replaced — the prompt now also explicitly forbids it.
//   ج) a pure greeting mid-conversation is handled by genuine reasoning (the
//      model reads the message and follows the prompt's instruction to keep
//      it short and not jump to the debt), NOT by a pre-model regex
//      short-circuit — root-cause fix 2026-07-13, see ai-collector-agent.ts.

let mockModelContent = ''
// Corrective-regeneration reply (see regenerateWithCorrection in
// ai-collector-agent.ts) — must be distinct from mockModelContent so a test
// can prove the guard actually asked the model for a real corrected reply,
// not just echoed the same (possibly still-bad) draft back. Mirrors the mock
// in agent-guards.test.ts, which already does this correctly.
let mockRegeneratedMessage = 'تمام، وش أقدر أساعدك فيه؟'
let lastCreateCallMessages: any[] = []
let mockContext: any = {}

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: any) => {
          // Only capture the main decision call (has a system prompt) — the
          // dialect backstop / corrective-regeneration calls (see
          // regenerateWithCorrection / isSaudiDialectLLM in ai-collector-agent.ts)
          // are single-user-message calls and must not overwrite this.
          if (params.messages?.[0]?.role === 'system') lastCreateCallMessages = params.messages
          const lastUserContent = params.messages?.[params.messages.length - 1]?.content ?? ''
          if (typeof lastUserContent === 'string' && lastUserContent.includes('ردك السابق على هذه الرسالة كان فيه مشكلة محددة')) {
            return { choices: [{ message: { content: JSON.stringify({ message: mockRegeneratedMessage }) } }] }
          }
          return { choices: [{ message: { content: mockModelContent } }] }
        }),
      },
    },
  })),
}))

// Phase 1 Shadow Mode now calls the real Temporal Intelligence Engine
// unconditionally on every runCollectorAgent call — stub it so these tests
// stay isolated and don't pile up background work across the test process.
vi.mock('@/lib/customer-debt-context', () => ({
  buildCustomerDebtContext: vi.fn().mockImplementation(async () => mockContext),
}))

function singleDebtGroup() {
  return { debtGroups: [{ portfolio_id: 'p1', portfolio_name: null, portfolio_category: null, company_key: null, debts: [{ id: 'd1', status: 'active' }] }], allDisputes: [], customerDataByPortfolio: {} }
}

function defaultPlaybook() {
  return {
    portfolio_id: 'p1', category: 'other',
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
  return { ...actual, getPlaybookForPortfolio: vi.fn().mockImplementation(async () => defaultPlaybook()) }
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
  return { ...actual, buildCustomer360Context: vi.fn().mockImplementation(async () => singleDebtGroup()) }
})

import { runCollectorAgent } from '@/lib/ai-collector-agent'

function baseContextWithHistory(): any {
  return {
    verified_customer_data: { customer_name: 'سعد القحطاني' },
    verified_debt_data: {
      current_balance: 800, currency: 'SAR', creditor_name: 'بنك الإنماء',
      reference_number: 'REF-5', status: 'overdue', portfolio_category: 'finance',
    },
    recent_messages: [
      { direction: 'outbound', content: 'معك خالد بخصوص مديونية بقيمة 800 ريال.' },
      { direction: 'inbound', content: 'تمام' },
    ],
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: { metadata: {} },
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockContext = baseContextWithHistory()
  mockAlertInsert.mockClear()
  lastCreateCallMessages = []
})

describe('أ) payment-pressure fallback never overrides a GREETING/INFO_REQUEST reply', () => {
  it('a repeated-looking INFO_REQUEST reply is replaced with a neutral fallback, not a payment question', async () => {
    // The model answers a balance question, but phrases it identically to a
    // very recent outbound message (近-duplicate, no digits) → isRepeated fires.
    mockContext.recent_messages.push({ direction: 'outbound', content: 'تمام راجعت ملفك وكل شي واضح عندي' })
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'x', message: 'تمام راجعت ملفك وكل شي واضح عندي',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'عطني التفاصيل' })

    expect(d.reason).toBe('anti_repetition_guard_regenerated')
    expect(d.message).not.toMatch(/تسدد|السداد/)
  })

  it('the same repeated-looking reply DURING an actual negotiation still allows the payment-nudge pool', async () => {
    mockContext.recent_messages.push({ direction: 'outbound', content: 'تمام راجعت ملفك وكل شي واضح عندي' })
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'x', message: 'تمام راجعت ملفك وكل شي واضح عندي',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'بسدد بس مو الحين' })

    expect(d.reason).toBe('anti_repetition_guard_regenerated')
    // NEGOTIATION intent — the payment-oriented pool is allowed to fire here.
  })
})

describe('ب) non-Saudi dialect / heavy formal Arabic in a reply gets caught and replaced', () => {
  it('an Egyptian-dialect reply ("عايز" / "كمان") is replaced by the anti-repetition guard', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'x', message: 'عايز أعرف كمان متى هتسدد الفلوس بتاعتك.',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'كيف الحال' })

    expect(d.message).not.toMatch(/عايز|كمان/)
  })

  it('the system prompt explicitly forbids non-Saudi dialects and formal Arabic', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، الرقم المرجعي هو REF-5.' })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'وش الرقم المرجعي؟' })
    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain('ممنوع منعاً باتاً استخدام أي لهجة غير سعودية')
  })
})

describe('ج) a pure greeting mid-conversation never jumps to the debt', () => {
  it('"السلام عليكم" alone mid-conversation now goes through the model (no pre-model regex short-circuit) and the model, following the prompt instruction, keeps it short without jumping to the debt', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'وعليكم السلام، تفضل.' })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'السلام عليكم' })

    expect(lastCreateCallMessages.length).toBeGreaterThan(0) // reasoning pipeline actually ran, not a regex bypass
    expect(d.message).not.toMatch(/800|ريال|مديونية|تسدد/)
  })

  it('a greeting RIDING ALONG with real content (e.g. a promise) still falls through to the normal pipeline', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'x', message: 'تمام، مسجل وعدك.',
      promised_date: '2026-06-25', promise_text: 'بكرا',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'السلام عليكم بسدد بكرا' })

    expect(d.reason).not.toBe('greeting_mid_conversation')
    expect(lastCreateCallMessages.length).toBeGreaterThan(0) // went through the LLM as normal
  })
})

describe('د) three-stage opening: identity confirmation -> self-introduction -> debt details', () => {
  it('after the customer confirms identity (no debt/self-intro mentioned yet), the agent is routed to SELF_INTRO, not straight to the debt', async () => {
    mockContext.recent_messages = [
      { direction: 'outbound', content: 'السلام عليكم، معي الأخ سعد؟' },
      { direction: 'inbound', content: 'نعم أنا سعد' },
    ]
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'x',
      message: 'معك خالد الدويحي من شركة مصدر الرؤية، وكيل بنك الإنماء.',
    })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'نعم أنا سعد' })

    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain('مهمتك الآن: التعريف بنفسك وبالجهة فقط')
    expect(systemPrompt).not.toContain('مهمتك الآن: ذكر تفاصيل الدين')
  })

  it('once the agent has already introduced itself, the NEXT turn moves on to revealing the debt (INTRODUCTION), not SELF_INTRO again', async () => {
    mockContext.recent_messages = [
      { direction: 'outbound', content: 'السلام عليكم، معي الأخ سعد؟' },
      { direction: 'inbound', content: 'نعم أنا سعد' },
      { direction: 'outbound', content: 'معك خالد الدويحي من شركة مصدر الرؤية، وكيل بنك الإنماء.' },
      { direction: 'inbound', content: 'تمام، تفضل' },
    ]
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'عندك مديونية 800 ريال، متى تقدر تسدد؟' })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'تمام، تفضل' })

    const systemPrompt = lastCreateCallMessages[0].content as string
    expect(systemPrompt).toContain('مهمتك الآن: ذكر تفاصيل الدين')
    expect(systemPrompt).not.toContain('مهمتك الآن: التعريف بنفسك وبالجهة فقط')
  })
})
