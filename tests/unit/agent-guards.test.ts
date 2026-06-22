import { describe, it, expect, vi, beforeEach } from 'vitest'

// The LLM output is controlled per-test via this mutable variable, so we can
// feed the agent the EXACT "bad" model reply (re-asking an answered question,
// deflecting to management) and prove the deterministic guards override it.
let mockModelContent = ''
let mockContext: any = {}

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async () => ({
          choices: [{ message: { content: mockModelContent } }],
        })),
      },
    },
  })),
}))

// Stub the DB-backed context so the test is pure (no Supabase needed).
vi.mock('@/lib/customer-debt-context', () => ({
  buildCustomerDebtContext: vi.fn().mockImplementation(async () => mockContext),
}))

import { runCollectorAgent } from '@/lib/ai-collector-agent'

// DB returns messages NEWEST-FIRST (order by sent_at desc) — match that here.
function baseContext(): any {
  return {
    verified_customer_data: { customer_name: 'حذيفة يوسف' },
    verified_debt_data: {
      current_balance: 2344, currency: 'SAR', creditor_name: 'بنك الإنماء',
      reference_number: 'REF-99', status: 'promised', portfolio_category: 'finance',
    },
    recent_messages: [
      { direction: 'inbound', content: 'بسدد يوم 25' },
      { direction: 'outbound', content: 'متى تقدر تسدد المبلغ؟' },
    ],
    recent_promises: [{ status: 'pending', promised_amount: 2344, promised_date: '2026-06-25' }],
    recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: {},
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockContext = baseContext()
})

describe('collector agent — deterministic anti-redundancy guards', () => {
  it('(A) does NOT re-ask the payment date when a promise is already on file', async () => {
    // Model misbehaves and re-asks the date even though it is already recorded.
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'model_reask',
      message: 'طيب متى بالضبط تقدر تسدد المبلغ؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'طيب' })

    expect(d.reason).toBe('promise_on_file_no_reask')
    expect(d.message).not.toMatch(/متى/)        // no "when will you pay" re-ask
    expect(d.message).toContain('2026-06-25')   // acknowledges the recorded date
  })

  it('(A2) record_promise with no fresh date but promise on file → acknowledge, not re-ask', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'model_reask',
      message: 'إيش التاريخ بالضبط اللي تقدر تسدد فيه؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'طيب' })

    expect(d.reason).toBe('promise_already_on_file')
    expect(d.message).toContain('2026-06-25')
    expect(d.promised_date).toBeNull()
  })

  it('(B) answers a known fact directly instead of deflecting to management', async () => {
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'human_review', reason: 'model_deflect',
      message: 'لحظة بأرجع للإدارة وأتأكد من المبلغ وأرد عليك', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'كم المبلغ المطلوب مني؟' })

    expect(d.reason).toBe('answered_from_case_file')
    expect(d.message).toContain('2,344')        // direct answer from the case file
    expect(d.message).not.toMatch(/الإدارة/)
  })

  it('(B2) still escalates when the asked-for info is truly absent', async () => {
    mockContext.recent_promises = []
    mockContext.verified_debt_data.reference_number = null   // not in the system
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'human_review', reason: 'model_deflect',
      message: 'الرقم المرجعي مو ظاهر لي، بأتحقق وأرد عليك', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'وش الرقم المرجعي لملفي؟' })

    // No fact to supply → guard must NOT fabricate; deflection is allowed.
    expect(d.reason).not.toBe('answered_from_case_file')
  })

  it('(D) ACCEPTS the promise when customer says "بكرا" (alef spelling) — no re-ask loop', async () => {
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'customer_gave_date',
      message: 'تمام، بانتظار سدادك بكرا. أرسل لي الإيصال بعد التحويل.', promised_date: '2026-06-22',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'خلاص بسدد بكرا' })

    expect(d.action).toBe('record_promise')           // promise recorded, NOT re-asked
    expect(d.promised_date).toBe('2026-06-22')
    expect(d.reason).not.toContain('guard')
  })

  it('(E) ACCEPTS the promise with Arabic-Indic numerals (يوم ٣٠)', async () => {
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'customer_gave_date',
      message: 'تمام، مسجّل يوم 30. أرسل لي الإيصال بعدها.', promised_date: '2026-06-30',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'قلت لك يوم ٣٠ الشهر' })

    expect(d.action).toBe('record_promise')
    expect(d.promised_date).toBe('2026-06-30')
  })

  it('(F) records a RELATIVE promise ("مع الراتب") via promise_text, no exact date needed', async () => {
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'relative_timing',
      message: 'تمام، بانتظار سدادك مع الراتب. أرسل لي الإيصال بعدها.',
      promised_date: null, promise_text: 'مع نزول الراتب',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'بسدده مع الراتب' })

    expect(d.action).toBe('record_promise')
    expect(d.promise_text).toBe('مع نزول الراتب')
    expect(d.promised_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)   // best-effort follow-up date filled
  })

  it('(G) asks once (not a loop) when the customer shows intent but NO timing', async () => {
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'no_timing',
      message: 'تمام سجلتها', promised_date: null, promise_text: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'اوكي بسدد' })

    expect(d.action).toBe('negotiate')
    expect(d.reason).toBe('promise_needs_timing')
  })

  it('(C) does not repeat the same question the customer already answered', async () => {
    mockContext.recent_promises = []
    mockContext.recent_messages = [
      { direction: 'inbound', content: 'ظروف صعبة' },
      { direction: 'outbound', content: 'وش سبب تأخرك في السداد؟' },
    ]
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_repeat',
      message: 'طيب وش سبب تأخرك في السداد بالضبط؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'ظروف صعبة' })

    expect(d.reason).toBe('repeated_question_guard')
    expect(d.message).not.toBe('طيب وش سبب تأخرك في السداد بالضبط؟')
  })
})
