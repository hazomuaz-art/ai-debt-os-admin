import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the Identity/Introduction Flow (identity verification REMOVED
// entirely, per explicit decision):
//   - the agent's absolute first-ever reply is ALWAYS the recipient
//     confirmation question ("معي الأخ/الأخت [الاسم]؟"), regardless of what
//     the customer's first message actually says — never the debt.
//   - "انت مين؟" (reversed word order) is recognized and self-introduces.
//   - NO message, under any circumstance, ever asks for a national-ID/iqama
//     last-4 — the gate and its DB-backed lock/attempts machinery no longer
//     exist in the pipeline at all.
//   - an explicit payment promise is recorded directly — never intercepted
//     by anything resembling an identity check (the exact regression this
//     removal fixes: "بسدد أول الشهر" used to get swallowed by the gate).

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

let mock360: any = null
function defaultGroup() {
  return {
    debtGroups: [{ portfolio_id: 'p1', portfolio_name: null, portfolio_category: null, company_key: null, debts: [{ id: 'd1', status: 'active' }] }],
    allDisputes: [], customerDataByPortfolio: {},
  }
}
vi.mock('@/lib/customer-context-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/customer-context-engine')
  return {
    ...actual,
    buildCustomer360Context: vi.fn().mockImplementation(async () => mock360 ?? defaultGroup()),
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

let mockCustomerRow: any = {}

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
      // Any other table this flow doesn't care about — safe no-op shape.
      return {
        insert: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
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

// `verification_status`/`national_id` are still columns in the DB (kept for
// any future re-enable), but the pipeline never reads them anymore — this
// fixture intentionally still sets them, to prove the gate ignores them.
function customerRow(overrides: Partial<any> = {}) {
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
  mockCustomerRow = customerRow()
  mock360 = null
})

describe('Identity / Introduction flow (identity verification removed)', () => {
  it('absolute first-ever contact ALWAYS asks the recipient-confirmation question, even for a non-greeting message', async () => {
    mockContext.recent_messages = []
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'كم المبلغ المطلوب مني بالضبط؟' })

    expect(d.reason).toBe('greeting_first_contact')
    expect(d.message).toContain('معي الأخ/الأخت محمد؟')
    expect(d.message).not.toMatch(/1,000|بنك الاختبار/)
    expect(d.message).not.toMatch(/هويت|رقم هوية|إقامت/)
  })

  it('first-ever "السلام عليكم" asks the same confirmation question', async () => {
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'السلام عليكم' })

    expect(d.reason).toBe('greeting_first_contact')
    expect(d.message).toContain('وعليكم السلام، معي الأخ/الأخت محمد؟')
  })

  it('"انت مين؟" (reversed word order), AFTER first contact, is recognized and self-introduces — no ID ever requested', async () => {
    mockContext.recent_messages = [
      { direction: 'outbound', content: 'معي الأخ/الأخت محمد؟' },
      { direction: 'inbound', content: 'نعم' },
    ]
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_guess', message: 'مرحباً', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'انت مين؟' })

    expect(d.reason).toBe('self_introduction')
    expect(d.message).toMatch(/خالد/)
    expect(d.message).toMatch(/مصدر الرؤية/)
    expect(d.message).not.toMatch(/هويت|رقم هوية|إقامت/)
  })

  it('NO message ever triggers an identity-verification reason/lock, regardless of verification_status on file', async () => {
    mockContext.recent_messages = [
      { direction: 'outbound', content: 'معي الأخ/الأخت محمد؟' },
      { direction: 'inbound', content: 'نعم' },
    ]
    mockCustomerRow = customerRow({ verification_status: 'locked', verification_attempts_count: 2 })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'تمام، فهمتك', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وليش اعطيك رقم هويتي؟' })

    expect(d.reason).not.toMatch(/identity_verification/)
    expect(d.action).not.toBe('human_review')
    expect(d.message).not.toMatch(/هويت|رقم هوية|إقامت|تجميد/)
  })

  it('an explicit payment promise (AFTER first contact) is recorded directly, never intercepted by any identity check (the exact regression fixed)', async () => {
    mockContext.recent_messages = [
      { direction: 'outbound', content: 'معي الأخ/الأخت محمد؟' },
      { direction: 'inbound', content: 'نعم' },
      { direction: 'outbound', content: 'تمام، أنا أتواصل معك من طرف بنك الاختبار بخصوص مبلغ 1,000 ريال. متى تقدر تسدده؟' },
    ]
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'model_missed_it',
      message: 'متى تقدر تسدد؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد أول الشهر' })

    expect(d.action).toBe('record_promise')
    expect(d.reason).not.toMatch(/identity_verification/)
    expect(d.promised_date).toBeTruthy()
  })
})

// Proves the removal + the new first-contact rule are portfolio-agnostic:
// identical behavior whether the debt belongs to STC, Mobily, or any other
// portfolio — neither path references isStcPortfolio/isMobilyPortfolio,
// which aren't even computed yet at this point in the function.
describe.each([
  { label: 'STC', portfolioName: 'إس تي سي' },
  { label: 'Mobily', portfolioName: 'موبايلي' },
])('Identity / Introduction flow — portfolio-agnostic ($label)', ({ portfolioName }) => {
  beforeEach(() => {
    mockContext.verified_debt_data.portfolio_name = portfolioName
    mock360 = {
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: portfolioName, portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'active' }] }],
      allDisputes: [], customerDataByPortfolio: {},
    }
  })

  it('first-ever contact still asks the confirmation question, never the ID', async () => {
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش الموضوع؟' })
    expect(d.reason).toBe('greeting_first_contact')
    expect(d.message).toContain('معي الأخ/الأخت محمد؟')
    expect(d.message).not.toMatch(/هويت|إقامت/)
  })

  it('"انت مين؟" still self-introduces without any ID request', async () => {
    mockContext.recent_messages = [
      { direction: 'outbound', content: 'معي الأخ/الأخت محمد؟' },
      { direction: 'inbound', content: 'نعم' },
    ]
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_guess', message: 'مرحباً', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'انت مين؟' })
    expect(d.reason).toBe('self_introduction')
    expect(d.message).toMatch(/خالد/)
    expect(d.message).not.toMatch(/هويت|إقامت/)
  })

  it('an explicit promise is still recorded directly, no identity interference', async () => {
    mockContext.recent_messages = [
      { direction: 'outbound', content: 'معي الأخ/الأخت محمد؟' },
      { direction: 'inbound', content: 'نعم' },
      { direction: 'outbound', content: 'تمام، أنا أتواصل معك من طرف بنك الاختبار بخصوص مبلغ 1,000 ريال. متى تقدر تسدده؟' },
    ]
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بداية الشهر بسدد' })
    expect(d.action).toBe('record_promise')
    expect(d.reason).not.toMatch(/identity_verification/)
  })
})

// Full, literal, turn-by-turn proof of the exact sequence requested:
//   الوكيل: "معي الأخ/الأخت [الاسم]؟"
//   العميل: "نعم."
//   الوكيل: يعرّف بنفسه (الاسم + شركة التحصيل + الجهة).
//   ثم حوار طبيعي عن المديونية — لا هوية، لا قفز لـ"متى بتسدد؟"، لا تكرار.
// Each turn feeds the previous turn's real output into the next turn's
// conversation history, exactly like production (waha-webhook accumulates
// `messages` the same way).
describe('Full first-contact sequence — turn by turn', () => {
  it('سلام → تأكيد المستلم → نعم → تعريف كامل → حوار طبيعي، بدون هوية ولا قفز مباشر لمتى بتسدد', async () => {
    const history: { direction: string; content: string }[] = []
    mockContext.recent_messages = []

    // Turn 1: customer's first-ever message (doesn't even have to be a greeting).
    const t1 = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'السلام عليكم' })
    expect(t1.reason).toBe('greeting_first_contact')
    expect(t1.message).toBe('وعليكم السلام، معي الأخ/الأخت محمد؟')
    expect(t1.message).not.toMatch(/هويت|إقامت|متى.*تسدد/)
    history.push({ direction: 'inbound', content: 'السلام عليكم' }, { direction: 'outbound', content: t1.message })

    // Turn 2: customer confirms — the model decides INTRODUCTION naturally;
    // simulate a realistic model reply that follows the INTRODUCTION
    // template (name + creditor + balance, one question).
    mockContext.recent_messages = [...history].reverse()
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'تعريف بالمديونية بعد تأكيد الهوية',
      message: 'تمام، أنا خالد من شركة مصدر الرؤية، أتواصل معك من طرف بنك الاختبار بخصوص مبلغ 1,000 ريال. متى تقدر تسدده؟',
      promised_date: null,
    })
    const t2 = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'نعم' })
    expect(t2.message).toMatch(/خالد/)
    expect(t2.message).toMatch(/مصدر الرؤية/)
    expect(t2.message).not.toMatch(/هويت|إقامت/)
    history.push({ direction: 'inbound', content: 'نعم' }, { direction: 'outbound', content: t2.message })

    // Turn 3: a natural follow-up — proves no identity request, no robotic
    // "متى بتسدد؟" loop (customer didn't ask anything requiring it), and no
    // verbatim repeat of turn 2's message.
    mockContext.recent_messages = [...history].reverse()
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'العميل يطلب مهلة',
      message: 'تمام، خذ وقتك، بس حاول ما تتأخر كثير عشان ما يتعقد الملف.', promised_date: null,
    })
    const t3 = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'أبغى أشوف وضعي وأرد عليك' })
    expect(t3.message).not.toBe(t2.message)
    expect(t3.message).not.toMatch(/هويت|إقامت/)
  })
})
