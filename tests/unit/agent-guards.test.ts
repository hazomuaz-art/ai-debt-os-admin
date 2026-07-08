import { describe, it, expect, vi, beforeEach } from 'vitest'

// The LLM output is controlled per-test via this mutable variable, so we can
// feed the agent the EXACT "bad" model reply (re-asking an answered question,
// deflecting to management) and prove the deterministic guards override it.
let mockModelContent = ''
// Corrective-regeneration call (see regenerateWithCorrection in
// ai-collector-agent.ts) — distinct from mockModelContent so tests can prove
// the guard actually triggered a real second model call, not a static bank
// pick. Defaults to a generic non-repeating reply.
let mockRegeneratedMessage = 'تمام، خلنا نمشي بخطوة فعلية مختلفة الحين.'
let mockContext: any = {}

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: any) => {
          const lastUserContent = params.messages?.[params.messages.length - 1]?.content ?? ''
          if (typeof lastUserContent === 'string' && lastUserContent.includes('هل هذا النص مكتوب باللهجة السعودية')) {
            return { choices: [{ message: { content: JSON.stringify({ is_saudi: true, foreign_word: null }) } }] }
          }
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
// unconditionally on every runCollectorAgent call (see ai-collector-agent.ts)
// — stub it here so these unrelated tests don't make real DB calls or pile
// up background work across the shared test process.
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
  return { debtGroups: [{ portfolio_id: 'p1', portfolio_name: null, portfolio_category: null, company_key: null, debts: [{ id: 'd1', status: 'active' }] }], allDisputes: [], customerDataByPortfolio: {} }
}
// Phase 2: Company Playbook — default to a permissive non-insurance playbook
// so the 33 pre-existing tests above are unaffected; Phase 2 tests override
// per-test via mockPlaybook.
let mockPlaybook: any = null
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
  return {
    ...actual,
    getPlaybookForPortfolio: vi.fn().mockImplementation(async () => mockPlaybook ?? defaultPlaybook()),
  }
})

// Stub the DB write path used by the missing-account alert guard — tests
// must never hit a real network call.
const mockAlertInsert = vi.fn().mockResolvedValue({ data: null, error: null })
// Default customer gate-state row: verified + no opt-out + no pending
// clarification, so the new §1/§2/§4 conversation-gates checks (which all
// read this row via createServiceClient) never block any pre-existing test.
// Tests for those gates specifically override this per-test.
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

// Legal Escalation: keep the real deterministic detect/render functions,
// but stub the DB-backed lock check + open call. Defaults to "no open
// escalation" so the 52 pre-existing tests are unaffected.
let mockOpenEscalation: any = null
// vi.hoisted is required here (unlike the plain `let` mocks above) because
// this vi.fn() is referenced DIRECTLY at the factory's own top level below,
// not inside a nested lazy closure — without vi.hoisted it would be read
// before its `const` initializer runs, since vi.mock factories execute
// during hoisted import resolution, ahead of ordinary module statements.
const mockOpenEscalationCall = vi.hoisted(() => vi.fn().mockResolvedValue('esc-1'))
vi.mock('@/lib/legal-escalation', async () => {
  const actual = await vi.importActual<any>('@/lib/legal-escalation')
  return {
    ...actual,
    getOpenEscalation: vi.fn().mockImplementation(async () => mockOpenEscalation),
    openEscalation: mockOpenEscalationCall,
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

// DB returns messages NEWEST-FIRST (order by sent_at desc) — match that here.
function baseContext(): any {
  return {
    verified_customer_data: { customer_name: 'حذيفة يوسف' },
    verified_debt_data: {
      current_balance: 2344, currency: 'SAR', creditor_name: 'بنك الإنماء',
      reference_number: 'REF-99', status: 'promised', portfolio_category: 'finance',
    },
    // Includes a prior self-introduction turn so `hasIntroducedSelf` in the
    // intent router reads true — these fixtures simulate a MID-conversation
    // exchange (testing promise/dispute/forbidden-phrase guards), not the
    // very first greeting/self-intro turn, so intent must not land on
    // SELF_INTRO here (that has its own dedicated enforcement guard/tests).
    recent_messages: [
      { direction: 'inbound', content: 'بسدد يوم 25' },
      { direction: 'outbound', content: 'متى تقدر تسدد المبلغ؟' },
      { direction: 'outbound', content: 'معك خالد الدويحي من شركة مصدر الرؤية، وكيل بنك الإنماء.' },
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
  mockPlaybook = null
  mockAlertInsert.mockClear()
  mockOpenEscalation = null
  mockOpenEscalationCall.mockClear()
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
    // "tomorrow" computed relative to the actual current date, not a
    // hardcoded literal — a fixed past-tense date here would correctly get
    // rejected by isSaneDate() and silently replaced by the fallback,
    // making this test flaky-by-construction as time passes.
    const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10)
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'customer_gave_date',
      message: 'تمام، بانتظار سدادك بكرا. أرسل لي الإيصال بعد التحويل.', promised_date: tomorrow,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'خلاص بسدد بكرا' })

    expect(d.action).toBe('record_promise')           // promise recorded, NOT re-asked
    expect(d.promised_date).toBe(tomorrow)
    expect(d.reason).not.toContain('guard')
  })

  it('(E) ACCEPTS the promise with Arabic-Indic numerals (يوم ٣٠)', async () => {
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'customer_gave_date',
      message: 'تمام، مسجّل يوم 30. أرسل لي الإيصال بعدها.', promised_date: '2026-06-30',
    })
    // Real bug this fixes: this test used to omit messageTimestamp, so
    // "today" defaulted to the REAL current date — the moment the calendar
    // rolled past June, day-30 was no longer resolvable within June and the
    // hardcoded '2026-06-30' expectation broke every month. A fixed
    // reference date (matching temporal-engine.test.ts's FIXED_NOW) makes
    // this deterministic regardless of when the suite actually runs.
    const d = await runCollectorAgent({
      company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'قلت لك يوم ٣٠ الشهر',
      messageTimestamp: '2026-06-24T10:00:00Z',
    })

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

  it('(L2) refusing to pay AND disputing the amount in the same message is never recorded as a promise, even with a fabricated date — the exact real production incident (2026-07-05)', async () => {
    // Real customer text, verbatim, from a live conversation: an explicit
    // refusal ("راتبي ما يكفي اني اسدد") combined with an explicit dispute
    // declaration ("معترض على مبلغ المديونية") in one message. The model, on
    // its own, chose record_promise and hallucinated "2026-07-27" — a date
    // that never appeared anywhere in this message, apparently pulled from
    // an unrelated salary-day mention days earlier in the same long
    // conversation. The customer was then told "تمام، مسجّل وعدك بالسداد
    // بتاريخ 2026-07-27" and, understandably, replied confused ("سداد ايش؟").
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'model_confused',
      message: 'تمام، مسجّل وعدك بالسداد بتاريخ 2026-07-27. بانتظار سدادك، وأرسل لي صورة الإيصال بعد التحويل.',
      promised_date: '2026-07-27', promise_text: 'وعد',
    })
    const d = await runCollectorAgent({
      company_id: 'c', customer_id: 'u', debt_id: 'd',
      message: 'راتبي ما يكفي اني اسدد وكمان انا معترض علي مبلغ المديونيه واحس انها ظلم',
    })

    expect(d.action).not.toBe('record_promise')
    expect(d.promised_date).toBeNull()
    expect(d.message).not.toContain('2026-07-27')
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

    expect(d.reason).toBe('repeated_question_guard_regenerated')
    expect(d.message).not.toBe('طيب وش سبب تأخرك في السداد بالضبط؟')
    expect(d.message).toBe(mockRegeneratedMessage)
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

describe('Company Playbooks (Phase 2)', () => {
  it('(W) insurance-only concepts are stripped from a non-insurance (STC) reply even if the model mentions them', async () => {
    mockPlaybook = { portfolio_id: 'p1', category: 'telecom', discounts: { allowed: false, max_percent: 0, requires_admin_approval: true }, installments: { allowed: false, max_months: 0, requires_admin_approval: true }, fields_to_surface: [], allowed_dispute_types: [], notes: null, is_default: false }
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_confused',
      message: 'ملفك فيه حق الرجوع على الطرف الثالث.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'وضح لي الموضوع' })
    expect(d.message).not.toMatch(/حق\s*الرجوع|الطرف\s*الثالث/)
  })

  it('(X) insurance concepts are ALLOWED for an actual insurance portfolio', async () => {
    mockPlaybook = { portfolio_id: 'p2', category: 'insurance', discounts: { allowed: false, max_percent: 0, requires_admin_approval: true }, installments: { allowed: false, max_months: 0, requires_admin_approval: true }, fields_to_surface: [], allowed_dispute_types: ['recourse'], notes: null, is_default: false }
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_ok',
      message: 'ملفك مسجّل تحت حق الرجوع بسبب نسبة الخطأ.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'وضح لي الموضوع' })
    expect(d.message).toContain('حق الرجوع')
  })

  it('(Y) the agent NEVER invents an IBAN when none is approved — flags for review instead', async () => {
    mockContext.collection_account = null
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_invented',
      message: 'تمام، حوّل على آيبان SA4420000001234567891234 وأرسل الإيصال.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'موافق وين أحول؟' })

    expect(d.reason).toBe('missing_collection_account')
    expect(d.action).toBe('human_review')
    expect(d.message).not.toMatch(/SA\d{2}/)
    expect(mockAlertInsert).toHaveBeenCalledTimes(1)
    // Regression guard: system_alerts.severity has a DB CHECK constraint
    // (info|warning|error|critical) that silently rejects any other value
    // with no exception thrown — a real production bug this exact
    // assertion would have caught before deploy.
    expect(mockAlertInsert.mock.calls[0][0].severity).toMatch(/^(info|warning|error|critical)$/)
  })

  it('(Z) when a REAL approved account exists, the agent corrects a wrong/invented IBAN to the approved one', async () => {
    mockContext.collection_account = { method_type: 'iban', iban: 'SA0000000000000000000000', account_name: 'شركة الاختبار', bank_name: 'بنك الاختبار' }
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_invented',
      message: 'حوّل على آيبان SA9999999999999999999999 وأرسل الإيصال.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'موافق وين أحول؟' })

    expect(d.reason).toBe('account_corrected_from_collection_accounts')
    expect(d.message).toContain('SA0000000000000000000000')
    expect(d.message).not.toContain('SA9999999999999999999999')
    expect(mockAlertInsert).not.toHaveBeenCalled()
  })

  it('(AA) the exact production gap: model tells the customer to "transfer to the reference number" instead of a real account — blocked even with no IBAN pattern at all', async () => {
    mockContext.collection_account = null
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_confused_reference_with_account',
      message: 'تمام، حوّل على الرقم المرجعي: DEB-MQDGCLWZ-RPS وأرسل لي صورة الإيصال بعد التحويل', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'موافق على السداد، ابغى الآيبان أو الحساب البنكي عشان أحول' })

    expect(d.reason).toBe('missing_collection_account')
    expect(d.action).toBe('human_review')
    expect(d.message).not.toContain('DEB-MQDGCLWZ-RPS')
    expect(mockAlertInsert).toHaveBeenCalledTimes(1)
  })
})

describe('Insurance Engine (Phase 3)', () => {
  function insurancePlaybook() {
    return { portfolio_id: 'p_ins', category: 'insurance', discounts: { allowed: false, max_percent: 0, requires_admin_approval: true }, installments: { allowed: false, max_months: 0, requires_admin_approval: true }, fields_to_surface: [], allowed_dispute_types: ['recourse', 'third_party', 'recovered_deduction'], notes: null, is_default: false }
  }
  function insuranceGroup(customerData: Record<string, any>) {
    return {
      debtGroups: [{ portfolio_id: 'p_ins', portfolio_name: 'التعاونية', portfolio_category: 'insurance', company_key: 'tawuniya', debts: [{ id: 'd_ins', status: 'active' }] }],
      allDisputes: [],
      customerDataByPortfolio: { p_ins: [customerData] },
    }
  }

  it('(BB) "حق رجوع" classification when recourse_reason is on file — no AI resolution of the plain question', async () => {
    mockPlaybook = insurancePlaybook()
    mock360 = insuranceGroup({ recourse_reason: 'مخالفة شرط رخصة القيادة', fault_percentage: 70, recovery_number: 'REC-1', accident_date: '2026-01-01' })
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'ملفك مسجّل تحت حق الرجوع بسبب مخالفة شرط الرخصة، نسبة الخطأ 70%.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'وضح لي وش الموضوع' })
    expect(d.message).toContain('حق الرجوع')
  })

  it('(CC) "طرف ثالث" classification when there is accident data but NO recourse_reason', async () => {
    mockPlaybook = insurancePlaybook()
    mock360 = insuranceGroup({ recourse_reason: null, accident_date: '2026-01-01', recovery_number: 'REC-2' })
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'ملفك مسجّل كطرف ثالث على حادث بدون تأمين ساري.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'وضح لي وش الموضوع' })
    expect(d.message).toContain('طرف ثالث')
  })

  it('(DD) objection to fault percentage/recourse reason opens a LEGAL ESCALATION, with ZERO LLM call — not a generic human_review', async () => {
    const OpenAIMock = (await import('openai')).default as any
    OpenAIMock.mockClear()
    mockPlaybook = insurancePlaybook()
    mock360 = insuranceGroup({ recourse_reason: 'مخالفة شرط', fault_percentage: 70, accident_date: '2026-01-01' })
    mockContext.recent_promises = []
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'ليش نسبة الخطأ علي 70%؟ ما وافقت على هذا' })

    expect(d.action).toBe('human_review')
    expect(d.reason).toBe('legal_escalation_opened')
    expect(d.message).toContain('إدارة الشؤون القانونية')
    expect(mockOpenEscalationCall).toHaveBeenCalledWith(expect.objectContaining({ escalation_type: 'recourse_dispute', debt_id: 'd_ins' }))
    expect(OpenAIMock.mock.calls.length).toBe(0)
  })

  it('(EE) customer claims counter-evidence ("حذف مسترد" trigger) -> legal escalation (recovered_deduction), AI never confirms the claim falls', async () => {
    const OpenAIMock = (await import('openai')).default as any
    OpenAIMock.mockClear()
    mockPlaybook = insurancePlaybook()
    mock360 = insuranceGroup({ recourse_reason: 'لا يملك رخصة قيادة سارية', fault_percentage: 100, accident_date: '2026-01-01' })
    mockContext.recent_promises = []
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'هذا غير صحيح، رخصتي سارية وبترسل لك صورتها' })

    expect(d.action).toBe('human_review')
    expect(d.reason).toBe('legal_escalation_opened')
    expect(d.message).not.toMatch(/سقطت|نحذفها/)
    expect(mockOpenEscalationCall).toHaveBeenCalledWith(expect.objectContaining({ escalation_type: 'recovered_deduction' }))
    expect(OpenAIMock.mock.calls.length).toBe(0)
  })

  // 🔴 No longer a zero-LLM-call pre-model keyword scan — real production
  // incident (customer RAYMOND LASTRELLA BLANCAFLOR, 2026-07-08): the old
  // "محامي"/"محكمة" keyword check couldn't tell a genuine personal threat
  // from a customer quoting text WE sent them. The model now reads the full
  // message and reports legal_escalation_trigger itself (see rule §14); this
  // costs one real LLM call, which is the correct trade-off for actually
  // understanding intent instead of pattern-matching on scary words.
  it('(HH) a genuine personal lawyer mention (per the model\'s own semantic verdict) opens the escalation and overrides the reply', async () => {
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'ok',
      message: 'فهمتك، بس خلنا نحلها من دون ما توصل لهذي المرحلة.', promised_date: null,
      legal_escalation_trigger: 'lawyer_mention',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'إذا ما حليتوها بترفع القضية مع محاميي' })

    expect(d.action).toBe('human_review')
    expect(d.reason).toBe('legal_escalation_opened_by_model')
    expect(d.message).toContain('إدارة الشؤون القانونية')
    expect(mockOpenEscalationCall).toHaveBeenCalledWith(expect.objectContaining({ escalation_type: 'lawyer_mention' }))
  })

  // Real production incident (customer RAYMOND LASTRELLA BLANCAFLOR,
  // 2026-07-08): the company ran a separate SMS reminder campaign whose own
  // text mentions "المحامي"/legal wording. A customer who pasted/forwarded
  // that exact SMS into WhatsApp got treated as if THEY PERSONALLY mentioned
  // a lawyer — locking the conversation into legal-escalation mode for
  // words that were never the customer's own. The model's own semantic
  // verdict (legal_escalation_trigger: null here) correctly recognizes this
  // and lets the conversation continue normally.
  it('(HH2) quoting our OWN outbound SMS notice (containing "محامي") does NOT escalate — real incident', async () => {
    const OpenAIMock = (await import('openai')).default as any
    OpenAIMock.mockClear()
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'ok',
      message: 'إي هذا إشعار حقيقي من الشركة بخصوص ملفك، وش رايك تسدد الحين؟', promised_date: null,
    })
    const d = await runCollectorAgent({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      message: 'عزيزنا عميل موبايلي نفيدكم بأنه تم إشعاركم سابقًا بضرورة سداد مبلغ (852.42) ريال المستحق على هوية (XXXX9210) عبر حساب سداد (1000135507940555) ولم يتم السداد حتى تاريخه. وعليه، نؤكد أن عدم السداد سيترتب عليه إحالة ملفكم مباشرة للمحامي لاتخاذ الإجراءات القانونية دون أي إشعار إضافي، مع تحملكم كامل أتعاب المحامي والتكاليف القضائية المترتبة على ذلك. للتواصل عبر الواتساب: 0561153262',
    })

    expect(d.reason).not.toBe('legal_escalation_opened')
    expect(d.reason).not.toBe('customer_invoked_legal_challenge')
    expect(mockOpenEscalationCall).not.toHaveBeenCalled()
    expect(OpenAIMock.mock.calls.length).toBeGreaterThan(0)
  })

  it('(II) once an escalation is OPEN for this debt, every subsequent message gets the fixed legal reply — zero LLM, zero negotiation', async () => {
    const OpenAIMock = (await import('openai')).default as any
    OpenAIMock.mockClear()
    mockOpenEscalation = { id: 'esc-1', escalation_type: 'lawyer_mention', reason: 'old', opened_at: '2026-01-01' }
    mockContext.recent_promises = []
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'طيب اوكي بسدد بكرة، عطني خصم' })

    expect(d.action).toBe('human_review')
    expect(d.reason).toBe('legal_escalation_locked')
    expect(d.message).toContain('إدارة الشؤون القانونية')
    expect(d.message).not.toMatch(/خصم|تقسيط|بسدد/)
    expect(OpenAIMock.mock.calls.length).toBe(0)
    // the lock check never tries to re-open a new escalation
    expect(mockOpenEscalationCall).not.toHaveBeenCalled()
  })

  it('(FF) insurance terms NEVER appear for STC (telecom) even with an identical objection message', async () => {
    mockPlaybook = { portfolio_id: 'p1', category: 'telecom', discounts: { allowed: false, max_percent: 0, requires_admin_approval: true }, installments: { allowed: false, max_months: 0, requires_admin_approval: true }, fields_to_surface: [], allowed_dispute_types: [], notes: null, is_default: false }
    mock360 = { debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'STC', portfolio_category: 'telecom', company_key: 'stc', debts: [{ id: 'd1', status: 'active' }] }], allDisputes: [], customerDataByPortfolio: {} }
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_confused', message: 'ملفك فيه حق رجوع وطرف ثالث ونسبة خطأ.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'ليش نسبة الخطأ علي 70%؟ ما وافقت على هذا' })

    expect(d.message).not.toMatch(/حق\s*رجوع|طرف\s*ثالث/)
    // and the insurance-only forced-review guard must never fire for telecom
    expect(d.reason).not.toBe('insurance_dispute_review')
    expect(d.reason).not.toBe('recovered_deduction_review')
  })

  it('(GG) no accident data at all -> claim_type stays null, nothing insurance-specific is even mentioned', async () => {
    mockPlaybook = insurancePlaybook()
    mock360 = insuranceGroup({})
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'وصلت ملاحظتك بخصوص ملفك.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', message: 'وضح لي وش الموضوع' })
    expect(d.message).not.toMatch(/حق\s*رجوع|طرف\s*ثالث/)
  })
})

describe('Playbook real policy fields (company_policy / ai_instructions / forbidden_phrases / escalation_rules)', () => {
  it('(JJ) forbidden_phrases blocks a model reply containing a banned phrase, even though the model said it anyway', async () => {
    mockPlaybook = { ...defaultPlaybook(), forbidden_phrases: ['نص المبلغ بدون موافقة'] }
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_offered', message: 'تمام، تقدر تسدد نص المبلغ بدون موافقة الإدارة.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ممكن أسدد جزء بس؟' })

    expect(d.reason).toBe('forbidden_phrase_blocked')
    expect(d.message).not.toContain('نص المبلغ بدون موافقة')
  })

  it('(KK) a forbidden phrase configured on portfolio A never blocks a reply on portfolio B (no cross-portfolio leakage)', async () => {
    mockPlaybook = { ...defaultPlaybook(), forbidden_phrases: [] } // portfolio B's playbook has none configured
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'تمام، تقدر تسدد نص المبلغ بدون موافقة الإدارة.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ممكن أسدد جزء بس؟' })

    expect(d.reason).not.toBe('forbidden_phrase_blocked')
    expect(d.message).toContain('نص المبلغ بدون موافقة')
  })

  it('(LL) a portfolio escalation_rules entry opens a real legal escalation (playbook_mandated), zero LLM call', async () => {
    const OpenAIMock = (await import('openai')).default as any
    OpenAIMock.mockClear()
    mockPlaybook = { ...defaultPlaybook(), escalation_rules: [{ keywords: ['وسيط'], reason: 'العميل ذكر وسيطاً قانونياً غير معتاد' }] }
    mockContext.recent_promises = []
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بكلم وسيط بخصوص هذا' })

    expect(d.action).toBe('human_review')
    expect(d.reason).toBe('legal_escalation_opened')
    expect(mockOpenEscalationCall).toHaveBeenCalledWith(expect.objectContaining({ escalation_type: 'playbook_mandated', reason: 'العميل ذكر وسيطاً قانونياً غير معتاد' }))
    expect(OpenAIMock.mock.calls.length).toBe(0)
  })

  it('(MM) a portfolio escalation_rules entry never fires for a DIFFERENT portfolio that has no such rule configured', async () => {
    mockPlaybook = { ...defaultPlaybook(), escalation_rules: [] } // different portfolio, no custom rule
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'ok', message: 'تمام', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بكلم وسيط بخصوص هذا' })

    expect(d.reason).not.toBe('legal_escalation_opened')
    expect(mockOpenEscalationCall).not.toHaveBeenCalled()
  })

  // 🔴 lawyer_mention/legal_threat/complaint no longer have a fixed PRE-model
  // keyword check to compete with (see the redesign at rule §14 in
  // ai-collector-agent.ts and the "(HH)"/"(HH2)" tests above) — that
  // detection moved to the model's own post-reply semantic verdict. A
  // playbook_mandated custom rule is now the only PRE-model, keyword-driven
  // trigger left, so it correctly fires on its own configured keyword
  // without competing against anything else at that stage.
  it('(NN) a playbook escalation_rules entry still opens playbook_mandated correctly (pre-model, admin-configured)', async () => {
    mockPlaybook = { ...defaultPlaybook(), escalation_rules: [{ keywords: ['محامي'], reason: 'custom override attempt' }] }
    mockContext.recent_promises = []
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بكلم محاميي' })

    expect(mockOpenEscalationCall).toHaveBeenCalledWith(expect.objectContaining({ escalation_type: 'playbook_mandated', reason: 'custom override attempt' }))
  })
})

describe('Per-customer SADAD number takes priority over collection_accounts (STC-style portfolios)', () => {
  it('(OO) "وين أسدد؟" answers with the real per-customer SADAD number — never "بجهز لك طريقة السداد" when it already exists', async () => {
    mockContext.collection_account = null // no portfolio-wide account configured — correct for STC
    mockContext.debt = { metadata: { extra: { sadad_number: '880001' } } }
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_unsure', message: 'تمام، بجهّز لك طريقة السداد المعتمدة وأرسلها لك أول ما تتوفر.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وين أسدد؟' })

    expect(d.message).toContain('880001')
    expect(d.message).not.toMatch(/بجهّز لك طريقة السداد|أرجع للإدارة|آيبان|تحويل بنكي/)
    expect(d.reason).toBe('answered_from_case_file')
    expect(mockAlertInsert).not.toHaveBeenCalled() // no "missing account" alert when a real number exists
  })

  it('(PP) still never invents an IBAN/account when there is NEITHER a SADAD number NOR a collection_account', async () => {
    mockContext.collection_account = null
    mockContext.debt = {} // no sadad_number anywhere
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_invented', message: 'حوّل على آيبان SA1234567890123456789012.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وين أحول؟' })

    expect(d.reason).toBe('missing_collection_account')
    expect(d.message).not.toMatch(/SA\d{2}/)
  })

  it('(QQ) "رقم المفوتر؟" (a phrasing that previously bypassed the guard entirely) now gets the real SADAD number too', async () => {
    mockContext.collection_account = null
    mockContext.debt = { metadata: { extra: { sadad_number: '880002' } } }
    mockContext.recent_promises = []
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'model_guess', message: 'تحويل على رقم المرجعي الخاص بملفك.', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'رقم المفوتر؟' })

    expect(d.message).toContain('880002')
    expect(d.reason).toBe('answered_from_case_file')
  })
})

describe('Wrong-number handling — must never continue the collection workflow', () => {
  it('(RR) forces record_wrong_number even when the model tries to re-introduce itself instead', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_reintroduced',
      message: 'معك خالد الدويحي من شركة مصدر الرؤية، وكيل موبايلي.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'مين فلان؟ ما يخصني هذا الرقم' })

    expect(d.action).toBe('record_wrong_number')
    expect(d.reason).toBe('wrong_number_forced')
    expect(d.message).not.toContain('خالد الدويحي')
  })

  it('(SS) "الرقم غلط" on the very first-ever contact still gets recognized instead of falling into GREETING', async () => {
    mockContext.chronological_history = [] // no prior messages at all — first contact
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'model_greeting',
      message: 'وعليكم السلام، معي الأخ محمد؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'الرقم غلط' })

    expect(d.action).toBe('record_wrong_number')
  })

  it('(TT) the model correctly choosing record_wrong_number on its own is left untouched (no redundant override log)', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_wrong_number', reason: 'model_correct',
      message: 'تمام، آسف على الإزعاج، بنراجع الرقم.', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd', message: 'مو رقمي' })

    expect(d.action).toBe('record_wrong_number')
    expect(d.reason).toBe('model_correct')
  })
})
