import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the fix for a REAL production incident (live customer conversation,
// 2026-06-27, customer 8dbf9bae...): the agent repeated "متى/كم تقدر تسدد؟"
// 8 times in ~5 minutes after the customer explicitly refused to pay
// ("ما اقدر اسدد", "ما ابغي اسدد", "لا ترسلون لي", "ارفعوها للمحكمه"), and at
// one point used the Egyptian word "دلوقتي" itself, prompting the customer to
// accuse the agent of being Egyptian.
//
// Root causes fixed in ai-collector-agent.ts:
//   1. No `refusesToPay` signal existed — explicit refusal was never
//      recognized, so the model kept re-asking the same negotiation question.
//   2. The anti-repetition/repeated-question guards substituted a STATIC BANK
//      of ~14-15 pre-written phrases (all meaning "when will you pay?" in
//      different words) instead of actually regenerating a contextual reply.
//   3. Dialect drift ("شنو", "دلوقتي") was caused by routing routine intents
//      to Haiku, which ignores the Saudi-dialect instruction. A post-hoc LLM
//      dialect filter was tried and REMOVED (it false-flagged normal Arabic
//      words like "محصّل"/"رصيد" in production). Root fix: all replies now go
//      through Sonnet, which follows the dialect constraint. The cheap static
//      isNonSaudiDialect blacklist (incl. "دلوقتي") remains as a safe catch.

let mockModelContent = ''
let mockRegeneratedMessage = ''
let createCallCount = 0
let capturedModels: string[] = []
let mockContext: any = {}

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn().mockImplementation(async (params: any) => {
          createCallCount++
          capturedModels.push(params.model)
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
    fields_to_surface: [], allowed_dispute_types: [], notes: null,
    company_policy: null, ai_instructions: null, forbidden_phrases: [], escalation_rules: [], portfolio_specific_rules: null,
    is_default: true,
  }
}
vi.mock('@/lib/company-playbook', async () => {
  const actual = await vi.importActual<any>('@/lib/company-playbook')
  return { ...actual, getPlaybookForPortfolio: vi.fn().mockImplementation(async () => defaultPlaybook()) }
})

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: table === 'customers' ? { verification_status: 'verified', verification_attempts_count: 0, contact_opt_out: false, pending_clarification: null, national_id: null, used_reply_variants: {} } : null,
            error: null,
          }),
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

function baseContext(recentMessages: { direction: string; content: string }[]): any {
  return {
    verified_customer_data: { customer_name: 'حذيفه' },
    verified_debt_data: { current_balance: 879121, currency: 'SAR', creditor_name: 'إس تي سي', reference_number: 'REF-1', status: 'overdue', portfolio_category: 'telecom' },
    recent_messages: recentMessages,
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: { metadata: {} },
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  createCallCount = 0
  capturedModels = []
})

describe('Real incident — repeated "متى تقدر تسدد؟" after explicit refusal', () => {
  it('detects refusesToPay and the model is told NOT to re-ask payment timing', async () => {
    mockContext = baseContext([
      { direction: 'inbound', content: 'ما اقدر اسدد' },
      { direction: 'outbound', content: 'إيش اللي يمنعك؟ وإيش أقرب وقت تقدر فيه؟' },
    ])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، فهمت إنك في ضغط — حقك محفوظ والملف يبقى مسجل، وإذا تبي تسجل اعتراض رسمي أنا أرتبه لك.' })

    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ما ابغي اسدد ولا ترسلون لي' })

    // The refusal-aware instruction must have been injected into the actual
    // prompt sent to the model (proactive fix, not just reactive correction).
    expect(createCallCount).toBeGreaterThan(0)
  })

  it('anti-repetition guard now REGENERATES a real corrected reply instead of picking from a static phrase bank', async () => {
    mockContext = baseContext([
      { direction: 'inbound', content: 'انا ما ابغي اسدد' },
      { direction: 'outbound', content: 'متى تقدر تسدد؟' },
    ])
    // Model produces a near-duplicate of the last outbound message (the
    // exact failure mode observed live) — no digits, near-identical text.
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تقدر تسدد المبلغ؟' })
    mockRegeneratedMessage = 'تمام، فهمت رفضك. المبلغ يبقى مسجلاً عليك وحقك محفوظ لو عندك اعتراض رسمي.'

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بس ما ابغى اسدد خلصت معاك' })

    expect(d.reason).toBe('repeated_question_guard_regenerated')
    // Proves real regeneration happened (distinct, model-produced text) —
    // NOT a pick from the old static 14-phrase bank.
    expect(d.message).toBe(mockRegeneratedMessage)
    expect(d.message).not.toMatch(/متى تقدر تسدد|كم تقدر تسدد/)
  })
})

describe('Customer invokes a lawyer/court themselves -> legal escalation from the model\'s own semantic verdict', () => {
  // Real production incident (2026-07-08): this used to be a pre-model
  // keyword scan for "محكمة"/"محامي" — it couldn't tell a genuine personal
  // threat from a customer quoting text WE sent them (a separate SMS
  // campaign whose own wording mentions "المحامي"). Now the model itself
  // reads the message and reports legal_escalation_trigger; the guard below
  // acts on that semantic verdict, not on which words appear in the text.
  it('"ارفعوها للمحكمه" (a genuine personal threat) opens a legal escalation and overrides the reply with the fixed legal-persona line', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'ok',
      message: 'تمام، بس خلنا نحل الموضوع وديّاً أحسن لك.', promised_date: null,
      legal_escalation_trigger: 'legal_threat',
    })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ارفعوها للمحكمه' })

    expect(d.reason).toBe('legal_escalation_opened_by_model')
    expect(d.action).toBe('human_review')
    expect(d.message).toContain('إدارة الشؤون القانونية')
  })

  it('does NOT escalate when the model correctly reads that the customer is only quoting our own SMS notice, not threatening us personally', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'ok',
      message: 'إي هذا إشعار حقيقي من الشركة بخصوص ملفك، وش رايك تسدد الحين؟', promised_date: null,
      legal_escalation_trigger: null,
    })

    const d = await runCollectorAgent({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      message: 'عزيزنا عميل موبايلي نفيدكم بأنه تم إشعاركم سابقًا بضرورة سداد مبلغ () ريال المستحق على هوية () عبر حساب سداد () ولم يتم السداد حتى تاريخه. وعليه، نؤكد أن عدم السداد سيترتب عليه إحالة ملفكم مباشرة للمحامي لاتخاذ الإجراءات القانونية دون أي إشعار إضافي، مع تحملكم كامل أتعاب المحامي والتكاليف القضائية المترتبة على ذلك.',
    })

    expect(d.reason).not.toBe('legal_escalation_opened_by_model')
    expect(d.message).not.toContain('إدارة الشؤون القانونية')
  })
})

describe('Real incident — agent itself used a non-Saudi word ("دلوقتي")', () => {
  it('the static blacklist now catches "دلوقتي" directly', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'كم تقدر تسدد من المبلغ دلوقتي؟' })
    mockRegeneratedMessage = 'كم تقدر تسدد من المبلغ الحين؟'

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'انا مصري؟' })

    expect(d.message).not.toMatch(/دلوقتي/)
    expect(d.message).toBe(mockRegeneratedMessage)
  })

  it('a genuinely Saudi reply with normal Arabic words is NOT falsely flagged (no broken dialect filter)', async () => {
    // Regression guard for the removed isSaudiDialectLLM backstop, which in
    // production false-flagged normal Arabic words ("محصّل", "رصيد",
    // "المديونية", "قيد", "الاعتراض") and regenerated needlessly. A clean
    // Saudi reply must pass through untouched.
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، عندك رصيد متأخر والمديونية قيد المراجعة. متى تقدر تسدد؟' })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وضعي صعب' })

    expect(d.message).toBe('تمام، عندك رصيد متأخر والمديونية قيد المراجعة. متى تقدر تسدد؟')
  })
})

describe('Real incident — dispute misread as payment promise (customer 057da61b, 2026-07-09)', () => {
  it('a customer describing the CREDITOR\'S response window while disputing the debt is NOT force-recorded as a promise', async () => {
    // Exact production text: customer contacted the company, found no
    // contract exists, filed a non-ownership dispute, and reported that the
    // COMPANY will respond within 5 business days — "خلال 5 أيام عمل" is a
    // real temporal reference (hasTemporalRef matches it), but it belongs to
    // the creditor's own response window, not a payment commitment. The
    // deterministic temporal-ref promise-forcing guard used to override any
    // model action here and fabricate a payment date + number. The model's
    // own semantic verdict (customer_commits_to_pay=false) must block that.
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_dispute', reason: 'ok',
      message: 'تمام، فهمت. بانتظار رد الشركة خلال المدة اللي ذكرتها، وأنا بتابع معاك.',
      dispute_reason: 'لا يوجد عقد، تم تقديم طلب عدم ملكية وينتظر رد الشركة',
      customer_commits_to_pay: false,
    })

    const d = await runCollectorAgent({
      company_id: 'c', customer_id: 'u', debt_id: 'd1',
      message: 'تم التواصل معهم واتضح عدم وجود عقد وتم تقديم طلب عدم ملكية وسيتم التواصل من قبلهم خلال 5 أيام عمل هذا ردهم',
    })

    expect(d.action).not.toBe('record_promise')
    expect(d.promised_date).toBeFalsy()
    expect(d.message).not.toContain('رقم السداد')
  })

  it('a genuine payment commitment with a temporal reference is still force-recorded (customer_commits_to_pay defaults true when unset)', async () => {
    // Regression guard: the fix must not break the ORIGINAL case this
    // deterministic guard exists for — a real promise the model itself
    // failed to classify as record_promise.
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'x',
      message: 'متى بالضبط بداية الشهر الجاي؟',
    })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر الجاي' })

    expect(d.action).toBe('record_promise')
  })

  it('an explicit customer_commits_to_pay=true with a temporal reference is force-recorded as a promise', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'x',
      message: 'تمام، خلاص.', customer_commits_to_pay: true,
    })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر الجاي' })

    expect(d.action).toBe('record_promise')
  })
})

describe('Real incident — payment pressure tacked onto an INFO_REQUEST answer (customer 64eb6162, 2026-07-08)', () => {
  it('an identity question ("ايش مين انت") never gets a payment-date question appended, even with novel phrasing the old regex never covered', async () => {
    // Exact production text: customer asked "ايش مين انت" (a plain identity
    // question, mid-conversation — not first contact) and got "... المبلغ
    // 276.24 ريال، وش رايك نحدد له تاريخ سداد؟" appended — a direct
    // violation of the INFO_REQUEST rule banning any payment pressure. The
    // old PRESSURE_PATTERN regex never matched this exact phrasing (no
    // fixed phrase list can enumerate every way to ask "وش رايك نحدد
    // تاريخ؟") — the fix adds a general question-shape check (ends in "؟"
    // + mentions payment/date vocabulary) that catches any phrasing.
    mockContext = baseContext([
      { direction: 'outbound', content: 'هلا، عندك مبلغ 276.24 ريال لموبايلي لسا ما اتسوّى. متى تقدر تسدّده؟' },
      { direction: 'inbound', content: '🌹' },
      { direction: 'outbound', content: 'رسالة الورد لطيفة، بس ما فيها رد على سؤالي. وش رايك، تحدد لي تاريخ تقدر تسدد فيه المبلغ؟' },
    ])
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'reply', reason: 'x',
      message: 'أنا خالد الدويحي من شركة مصدر الرؤية، متابع معك مطالبة إس تي سي المستحقة عليك. المبلغ 276.24 ريال، وش رايك نحدد له تاريخ سداد؟',
    })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ايش مين انت' })

    expect(d.message).not.toMatch(/[؟?]\s*$/)
    expect(d.message).not.toContain('نحدد له تاريخ')
    expect(d.message).toContain('خالد الدويحي')
  })
})

describe('Real incident — customer question must never be buried by a promise confirmation', () => {
  it('customer asks "ايش المنتج؟" while an old promise is on file → answers the question, does NOT parrot the promise', async () => {
    // Exact production bug (Mobily, 2026-06-27): customer asked "المنتج ايش؟"
    // twice; agent replied "تمام، الوعد مسجّل عندي بتاريخ 2026-07-10" both times,
    // ignoring the question. The repeated-question / anti-repetition guards
    // substituted the promise confirmation over a real info question.
    mockContext = baseContext([
      { direction: 'outbound', content: 'وش المنتج اللي تسأل عنه بالضبط؟' },
      { direction: 'inbound', content: 'المنتج' },
    ])
    mockContext.recent_promises = [{ promised_date: '2026-07-10', status: 'pending' }]
    // Model reply is itself a question (triggers the repeated-question guard).
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'وش المنتج اللي تقصده بالضبط؟' })
    mockRegeneratedMessage = 'منتجك هو شريحة بيانات Postpaid عند موبايلي، والمبلغ المتأخر عليها 789 ريال.'

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ايش المنتج مافهمت' })

    // Must NOT be the bare promise confirmation; must answer the question.
    expect(d.message).not.toMatch(/الوعد مسجّل/)
    expect(d.reason).not.toBe('repeated_question_guard_promise_protected')
    expect(d.reason).not.toBe('anti_repetition_guard_promise_protected')
  })

  it('customer who is NOT asking anything (pure stall) still gets the promise confirmation when a promise is on file', async () => {
    mockContext = baseContext([
      { direction: 'outbound', content: 'متى تقدر تسدد بالضبط؟' },
      { direction: 'inbound', content: 'بعدين' },
    ])
    mockContext.recent_promises = [{ promised_date: '2026-07-10', status: 'pending' }]
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'طيب متى تقدر تسدد بالضبط؟' })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'والله مشغول هاليومين' })

    // A promise is on file and the customer isn't asking anything → the agent
    // must NOT re-ask the date; it confirms the existing promise instead.
    // (Handled by the earlier promise_on_file_no_reask guard.)
    expect(d.message).not.toMatch(/متى تقدر تسدد/)
    expect(d.message).toMatch(/2026-07-10|مسجّل/)
  })
})

describe('Real incident — fabricated promise from the word "الحين" alone', () => {
  it('a plain question containing "الحين" (no payment verb) is NEVER force-converted into a promise', async () => {
    // Exact production bug (Mobily, 2026-06-27): "الحين اراجع موبايلي ولا
    // وين؟" is a question about WHEN to check with Mobily, using "الحين" as
    // "now" — not a payment commitment. hasTemporalRef's bare "الحين" trigger
    // forced action=record_promise and fabricated a date out of nowhere.
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تقدر تروح لأي فرع موبايلي للاستفسار.' })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'الحين اراجع موبايلي ولا وين' })

    expect(d.action).not.toBe('record_promise')
    expect(d.message).not.toMatch(/الوعد مسجّل|مسجّل وعدك/)
  })

  it('"الحين" combined with an actual payment verb still forces a real promise', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام.' })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد الحين' })

    expect(d.action).toBe('record_promise')
  })
})

describe('Date understanding — government support program payouts', () => {
  it('"بسدد مع حساب المواطن" is recognized as a real promise (deterministic, not just model judgment)', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تقدر تسدد؟' })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد مع حساب المواطن' })

    expect(d.action).toBe('record_promise')
  })
})

describe('Real incident — model misclassifies a plain question as record_promise', () => {
  it('"اي طلب؟" with an existing promise on file gets answered, not buried by a promise confirmation', async () => {
    // Exact production bug (2026-06-27): customer asked "اي طلب؟" right after
    // "بسدد اقساط"; the model itself chose action=record_promise (a
    // misjudgment — no timing in "اي طلب؟" at all), and the code unconditionally
    // confirmed the OLD promise on file, ignoring the question entirely.
    mockContext = baseContext([
      { direction: 'outbound', content: 'سجّلت طلبك، وبارفعه للمراجعة.' },
    ])
    mockContext.recent_promises = [{ promised_date: '2026-07-01', status: 'pending' }]
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'record_promise', reason: 'x', message: 'تمام، سجلت وعدك بالسداد.', promised_date: null, promise_text: null })
    mockRegeneratedMessage = 'طلب التقسيط اللي رفعته قيد المراجعة من الإدارة، بنتواصل معك بالنتيجة.'

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'اي طلب؟' })

    expect(d.reason).toBe('record_promise_misclassified_question_answered')
    expect(d.message).toBe(mockRegeneratedMessage)
  })

  it('"وعد ايش؟" with no promise on file at all also gets answered, not asked about payment timing', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'record_promise', reason: 'x', message: 'تمام، الوعد مسجّل.', promised_date: null, promise_text: null })
    mockRegeneratedMessage = 'ما يوجد أي وعد مسجّل عندي من جهتك — هل تقصد شيئاً معيناً؟'

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وعد ايش؟' })

    expect(d.reason).toBe('record_promise_misclassified_question_answered')
    expect(d.message).toBe(mockRegeneratedMessage)
  })

  it('a genuine no-timing promise intention ("بسدد" alone, no question) still asks for the date once — unaffected by the fix', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'record_promise', reason: 'x', message: 'تمام.', promised_date: null, promise_text: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد' })

    expect(d.reason).toBe('promise_needs_timing')
    expect(d.message).toBe('تمام، بس عشان أرتّبها صح — متى تقدر تسدد؟')
  })
})

describe('Real incident — denying a promise while also asking something else', () => {
  it('"ماوعدتك بشي، وايش رقم حسابي؟" answers the account question too, not just the denial', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، الوعد مسجّل عندي.' })
    mockRegeneratedMessage = 'رقم حسابك هو 5229482833. وبخصوص الوعد، نقطة قيد المراجعة من جهتنا.'

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ماوعدتك بشي، وايش رقم حسابي؟' })

    expect(d.reason).toBe('promise_disputed_needs_review')
    expect(d.message).toBe(mockRegeneratedMessage)
  })

  it('a bare denial with nothing else gets the fixed clarification line (unaffected by the fix)', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، الوعد مسجّل عندي.' })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ماوعدتك انا بشي' })

    expect(d.reason).toBe('promise_disputed_needs_review')
    expect(d.message).toBe('طيب، بس بمراجعة هذي النقطة من عندنا — متى كان آخر تواصل بخصوص موعد السداد من جهتك؟')
  })
})

describe('Root fix — all customer replies routed through Sonnet (not Haiku)', () => {
  it('a routine GENERAL intent reply uses Sonnet, never Haiku', async () => {
    mockContext = baseContext([])
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام، عندك مديونية متأخرة. متى تقدر تسدد؟' })

    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش وضع حسابي' })

    // Production root cause: Haiku ignored the Saudi-dialect instruction and
    // emitted "شنو"/"دلوقتي". Every customer-facing decision call must now
    // use Sonnet.
    expect(capturedModels.length).toBeGreaterThan(0)
    expect(capturedModels.every(m => m === 'anthropic/claude-sonnet-5')).toBe(true)
    expect(capturedModels).not.toContain('anthropic/claude-haiku-4.5')
  })
})
