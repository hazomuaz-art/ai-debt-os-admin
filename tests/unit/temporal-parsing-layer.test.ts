import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the Temporal Parsing Layer fix for the production case:
//   customer: "بحاول بدايه الشهر اذا تسهلت" (هاء instead of تاء مربوطة)
//   → the agent kept re-asking "متى تتوقع تسدد؟" / "وش تقترح؟" / "محتاج جواب
//     محدد منك" because hasTemporalRef's regex only recognized "بداية" with
//     ة, never "بدايه" with ه — a very common Saudi-WhatsApp spelling.
// Root cause: Business Logic (deterministic lexicon in hasTemporalRef),
// confirmed from production PM2 logs (reason: "promise_needs_timing" /
// "record_promise without any timing — asking once" for this exact text).
// Fix: a SCOPED `normalizeTemporalText()` used only by the temporal/promise
// extraction layer (hasTemporalRef, hasCommitmentWithVagueTiming,
// detectRequestedGraceDays, negatesImmediateTiming) — never the shared
// norm()/hasAny() used by ~25 unrelated signal detectors.

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
vi.mock('@/lib/customer-context-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/customer-context-engine')
  return {
    ...actual,
    buildCustomer360Context: vi.fn().mockImplementation(async () => mock360 ?? {
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: null, portfolio_category: null, company_key: null, debts: [{ id: 'd1', status: 'active' }] }],
      allDisputes: [], customerDataByPortfolio: {},
    }),
  }
})

let mockPlaybook: any = null
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
  return { ...actual, getPlaybookForPortfolio: vi.fn().mockImplementation(async () => mockPlaybook ?? defaultPlaybook()) }
})

vi.mock('@/lib/legal-escalation', async () => {
  const actual = await vi.importActual<any>('@/lib/legal-escalation')
  return { ...actual, getOpenEscalation: vi.fn().mockImplementation(async () => null), openEscalation: vi.fn().mockResolvedValue('esc-1') }
})

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }) }),
    })),
  })),
}))

import { runCollectorAgent } from '@/lib/ai-collector-agent'

function baseContext(overrides: Partial<any> = {}): any {
  return {
    verified_customer_data: { customer_name: 'محمد العتيبي' },
    verified_debt_data: { current_balance: 1000, currency: 'SAR', creditor_name: 'بنك الاختبار', reference_number: 'REF-1', status: 'active', portfolio_category: 'finance' },
    recent_messages: [
      { direction: 'outbound', content: 'متى تتوقع تسدد أول دفعة؟' },
      { direction: 'inbound', content: 'بحاول بدايه الشهر اذا تسهلت' },
    ],
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: {},
    ...overrides,
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockContext = baseContext()
  mockPlaybook = null
  mock360 = null
})

describe('1) the exact production case is fixed', () => {
  it('"بحاول بدايه الشهر اذا تسهلت" (هاء misspelling) records the promise, never re-asks', async () => {
    // Model misses it too, exactly like production — chose negotiate and re-asked.
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'model_missed_it',
      message: 'متى تتوقع تسدد؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بحاول بدايه الشهر اذا تسهلت' })

    expect(d.action).toBe('record_promise')
    expect(d.reason).toBe('promise_forced_from_temporal_ref')
    expect(d.message).not.toMatch(/متى تتوقع تسدد|وش تقترح|محتاج جواب محدد/)
    expect(d.promised_date).toBeTruthy()
  })
})

describe('2) regression: the correct تاء مربوطة spelling still works (never broke the original)', () => {
  it('"بحاول بداية الشهر إذا سهلت" (correct spelling) also records the promise', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'negotiate', reason: 'model_missed_it',
      message: 'متى تتوقع تسدد؟', promised_date: null,
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بحاول بداية الشهر إذا سهلت' })

    expect(d.action).toBe('record_promise')
    expect(d.reason).toBe('promise_forced_from_temporal_ref')
  })
})

describe('3) the same هاء/تاء variant works for "نهاية/نهايه الشهر"', () => {
  it('"بسدد نهايه الشهر" (هاء) records the promise', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد نهايه الشهر' })
    expect(d.action).toBe('record_promise')
  })

  it('"بسدد نهاية الشهر" (تاء مربوطة) still records the promise', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد نهاية الشهر' })
    expect(d.action).toBe('record_promise')
  })
})

describe('4) a vague conditional with NO real timing still never records a promise', () => {
  it('"إذا تيسرت" alone (no date/timing at all) → negotiate, not record_promise', async () => {
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_promise', reason: 'model_confused',
      message: 'تمام، مسجّل', promised_date: '2026-07-01', promise_text: 'إذا تيسرت',
    })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'إذا تيسرت بسدد' })

    expect(d.action).not.toBe('record_promise')
    expect(d.promised_date).toBeNull()
    expect(d.reason).toBe('promise_needs_timing')
  })

  it('"إن شاء الله قريب" alone (no date) → negotiate, not record_promise', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى بالضبط؟', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ان شاء الله قريب' })

    expect(d.action).not.toBe('record_promise')
  })
})

describe('5) portfolio-agnostic: the fix works identically on STC, Mobily, and Insurance', () => {
  const cases = [
    { label: 'STC', portfolioName: 'إس تي سي' },
    { label: 'Mobily', portfolioName: 'موبايلي' },
    { label: 'Insurance', portfolioName: 'تأمين تعاونية' },
  ]
  for (const c of cases) {
    it(`${c.label}: "بدايه الشهر" (هاء) still force-records the promise`, async () => {
      mockContext.verified_debt_data.portfolio_name = c.portfolioName
      mock360 = {
        debtGroups: [{ portfolio_id: 'p1', portfolio_name: c.portfolioName, portfolio_category: 'telecom', company_key: null, debts: [{ id: 'd1', status: 'active' }] }],
        allDisputes: [], customerDataByPortfolio: {},
      }
      mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
      const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بحاول بدايه الشهر اذا تسهلت' })

      expect(d.action).toBe('record_promise')
      expect(d.reason).toBe('promise_forced_from_temporal_ref')
    })
  }
})
