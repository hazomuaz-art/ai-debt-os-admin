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

// Customer 360 context: by default a single debt under a single portfolio —
// matches the legacy single-debt behavior so all pre-existing tests above
// don't need to know about multi-debt grouping at all. Multi-debt tests
// override this per-test.
let mock360: any = null
function singleDebtGroup() {
  return { debtGroups: [{ portfolio_id: 'p1', portfolio_name: null, portfolio_category: null, company_key: null, debts: [{ id: 'd1', status: 'active' }] }], allDisputes: [] }
}
vi.mock('@/lib/customer-context-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/customer-context-engine')
  return {
    ...actual,
    buildCustomer360Context: vi.fn().mockImplementation(async () => mock360 ?? singleDebtGroup()),
  }
})

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
  mock360 = null
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

  it('(H) "من أنت؟" always gets the exact fixed self-introduction with the real company name', async () => {
    mockContext.verified_debt_data = { ...mockContext.verified_debt_data, creditor_name: null, portfolio_name: 'إس تي سي' }
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_guess',
      message: 'مرحباً، كيف أقدر أساعدك اليوم؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'من أنت؟' })

    expect(d.reason).toBe('self_introduction')
    expect(d.message).toBe('أنا خالد الدويحي من شركة مصدر الرؤية، وكيل متابعة مطالبات شركة إس تي سي.')
  })

  it('(I) answers "وش الشركة؟" from portfolio_name when creditor_name is null (the STC import case)', async () => {
    mockContext.verified_debt_data = { ...mockContext.verified_debt_data, creditor_name: null, portfolio_name: 'إس تي سي' }
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'human_review', reason: 'model_deflect',
      message: 'ما عندي هالمعلومة حالياً، بتواصل مع الإدارة وأرد عليك', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'وش الشركة؟' })

    expect(d.reason).toBe('answered_from_case_file')
    expect(d.message).toContain('إس تي سي')
    expect(d.message).not.toMatch(/الإدارة/)
  })

  it('(J) "عطني التفاصيل" combines company/account/product/sadad/balance from metadata.extra', async () => {
    mockContext.verified_debt_data = { ...mockContext.verified_debt_data, creditor_name: null, portfolio_name: 'إس تي سي', account_number: 'STC-10001' }
    mockContext.debt = { metadata: { extra: { sadad_number: '880001', 'رقم المنتج': '50001234' } } }
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'human_review', reason: 'model_deflect',
      message: 'بتواصل مع الإدارة وأرد عليك بالتفاصيل', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'عطني التفاصيل' })

    expect(d.reason).toBe('answered_from_case_file')
    expect(d.message).toContain('إس تي سي')
    expect(d.message).toContain('STC-10001')
    expect(d.message).toContain('50001234')
    expect(d.message).toContain('880001')
  })

  it('(K) denying the debt ("ما عندي مديونية") is NEVER recorded as a promise, even if the model says so', async () => {
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'model_confused',
      message: 'تمام، مسجّل وعدك بالسداد', promised_date: '2026-06-25', promise_text: 'وعد',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'ما عندي مديونية' })

    expect(d.action).not.toBe('record_promise')
    expect(d.reason).toBe('denial_not_promise')
    expect(d.promised_date).toBeNull()
  })

  it('(L) does NOT record a promise from a vague conditional with no real timing — the exact production bug ("شوف الكشف ويصير خير")', async () => {
    mockContext.recent_promises = []
    // Model fabricates a date/promise_text even though the customer's own
    // message contains no timing or commitment at all.
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'وعد مشروط',
      message: 'تمام، بيوصلك الكشف خلال يوم عمل وبعدها نتابع السداد.',
      promised_date: '2026-06-25', promise_text: 'بعد شوف الكشف',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'شوف الكشف ويصير خير' })

    expect(d.action).not.toBe('record_promise')
    expect(d.promised_date).toBeNull()
    expect(d.promise_text).toBeNull()
  })

  it('(M) a customer denying a promise ever happened is never told it is confirmed — flags for review instead', async () => {
    mockContext.recent_promises = [{ status: 'pending', promised_amount: 1250.5, promised_date: '2026-06-25' }]
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'تذكير بالوعد',
      message: 'تمام، أنا مسجّل إنك بتسدد بتاريخ 2026-06-25. بانتظارك.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'ياحبيبي انا مو وعدتك بشي' })

    expect(d.reason).toBe('promise_disputed_needs_review')
    expect(d.action).toBe('human_review')
    expect(d.message).not.toMatch(/2026-06-25|مسجّل إنك بتسدد/)
  })

  it('(N) "وش اسمك" now triggers the exact self-introduction (was previously missed)', async () => {
    mockContext.verified_debt_data = { ...mockContext.verified_debt_data, creditor_name: null, portfolio_name: 'إس تي سي' }
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_guess',
      message: 'اسمي خالد، محصّل ديون.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'انت وش اسمك ؟' })

    expect(d.reason).toBe('self_introduction')
    expect(d.message).toBe('أنا خالد الدويحي من شركة مصدر الرؤية، وكيل متابعة مطالبات شركة إس تي سي.')
  })

  it('(O) INFO_REQUEST answer never carries a payment-pressure tail — the exact production bug ("والمهم موعدك بكرة")', async () => {
    mockContext.verified_debt_data = { ...mockContext.verified_debt_data, creditor_name: null, portfolio_name: 'إس تي سي' }
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'تأكيد أن هذه كل التفاصيل المتاحة والتذكير بالوعد',
      message: 'نعم، هذي كل التفاصيل المتاحة حالياً. والمهم موعدك بكرة 25/6 للسداد.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'هذي كل التفاصيل؟' })

    expect(d.reason).toBe('info_request_no_pressure')
    expect(d.message).not.toMatch(/موعدك|للسداد|المهم/)
    expect(d.message).toContain('هذي كل التفاصيل المتاحة')
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

describe('Customer 360 — multi-debt handling (Phase 1)', () => {
  it('(P) a single debt customer behaves exactly as before — no clarification, no LLM mock change needed', async () => {
    mock360 = { debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'STC', portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'active' }] }], allDisputes: [] }
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'تمام', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'كم المديونية؟' })
    expect(d.action).not.toBe('request_clarification')
  })

  it('(Q) greeting with debts under DIFFERENT portfolios → no clarification question at all', async () => {
    mock360 = {
      debtGroups: [
        { portfolio_id: 'p1', portfolio_name: 'STC', portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'active' }] },
        { portfolio_id: 'p2', portfolio_name: 'تأمين تعاونية', portfolio_category: 'insurance', company_key: null, debts: [{ id: 'd2', status: 'active' }] },
      ],
      allDisputes: [],
    }
    mockContext.recent_messages = []
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'السلام عليكم' })
    expect(d.action).not.toBe('request_clarification')
  })

  it('(R) "من أنت؟" with debts under different portfolios → still answers identity, no clarification', async () => {
    mock360 = {
      debtGroups: [
        { portfolio_id: 'p1', portfolio_name: 'STC', portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'active' }] },
        { portfolio_id: 'p2', portfolio_name: 'تأمين تعاونية', portfolio_category: 'insurance', company_key: null, debts: [{ id: 'd2', status: 'active' }] },
      ],
      allDisputes: [],
    }
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_guess', message: 'مرحباً', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'من أنت؟' })
    expect(d.action).not.toBe('request_clarification')
    expect(d.reason).toBe('self_introduction')
  })

  it('(S) a debt-related question with debts under DIFFERENT portfolios → deterministic clarification, ZERO LLM calls', async () => {
    const OpenAIMock = (await import('openai')).default as any
    OpenAIMock.mockClear()
    mock360 = {
      debtGroups: [
        { portfolio_id: 'p1', portfolio_name: 'STC', portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'active' }] },
        { portfolio_id: 'p2', portfolio_name: 'تأمين تعاونية', portfolio_category: 'insurance', company_key: null, debts: [{ id: 'd2', status: 'active' }] },
      ],
      allDisputes: [],
    }
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'كم المديونية المطلوبة مني؟' })

    expect(d.action).toBe('request_clarification')
    expect(d.reason).toBe('multi_portfolio_clarification_needed')
    expect(d.message).toContain('STC')
    expect(d.message).toContain('تأمين تعاونية')
    // The OpenAI client constructor itself was never reached — proves the
    // clarification short-circuit happens BEFORE any LLM call, not after.
    expect(OpenAIMock.mock.calls.length).toBe(0)
  })

  it('(T) customer names the company directly → resolves without asking again', async () => {
    mock360 = {
      debtGroups: [
        { portfolio_id: 'p1', portfolio_name: 'STC', portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'active' }] },
        { portfolio_id: 'p2', portfolio_name: 'تأمين تعاونية', portfolio_category: 'insurance', company_key: null, debts: [{ id: 'd2', status: 'active' }] },
      ],
      allDisputes: [],
    }
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'تمام، رصيدك ٢٠٠ ريال', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'أقصد مطالبة STC، كم باقي علي؟' })
    expect(d.action).not.toBe('request_clarification')
  })

  it('(U) multiple debts under the SAME portfolio → all claims listed, none dropped', async () => {
    mock360 = {
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'STC', portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'active' }, { id: 'd2', status: 'active' }] }],
      allDisputes: [],
    }
    mockContext.recent_promises = []
    mockContext.verified_debt_data = { ...mockContext.verified_debt_data, current_balance: 500, reference_number: 'REF-1' }
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'human_review', reason: 'model_deflect', message: 'بتواصل مع الإدارة وأرد عليك', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'كم المديونية المطلوبة مني؟' })

    expect(d.reason).toBe('answered_from_case_file')
    expect(d.message).toContain('مطالبة 1')
    expect(d.message).toContain('مطالبة 2')
  })

  it('(V) the exact production gap: model answers with only the FIRST claim and drops the second — guard forces both', async () => {
    mock360 = {
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'STC', portfolio_category: 'telecom', company_key: null, debts: [
        { id: 'd1', status: 'active', reference_number: 'REF-A', current_balance: 1250.5, currency: 'SAR' },
        { id: 'd2', status: 'disputed', reference_number: 'REF-B', current_balance: 400, currency: 'SAR' },
      ] }],
      allDisputes: [],
    }
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'العميل يسأل عن المبلغ المستحق',
      message: 'المبلغ المطلوب 1,250.5 ريال لإس تي سي.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'كم المديونية المطلوبة مني؟' })

    expect(d.reason).toBe('multi_debt_all_claims_listed')
    expect(d.message).toContain('مطالبة 1')
    expect(d.message).toContain('مطالبة 2')
  })
})
