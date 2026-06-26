import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the Temporal Parsing Layer (normalizeTemporalText, scoped to
// hasTemporalRef/hasCommitmentWithVagueTiming/detectRequestedGraceDays/
// negatesImmediateTiming in src/lib/ai-collector-agent.ts) keeps handling
// the common Saudi-WhatsApp spelling variants for TIMING words specifically
// — not a one-off test for "بداية الشهر" alone. Add a new pair to
// SPELLING_VARIANT_PAIRS below whenever a new common timing misspelling is
// found in production; it gets the same proof automatically.

let mockModelContent = ''
let mockContext: any = {}

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({ choices: [{ message: { content: mockModelContent } }] })) } },
  })),
}))

// Phase 1 Shadow Mode now calls the real Temporal Intelligence Engine
// unconditionally on every runCollectorAgent call — stub it so these tests
// stay isolated and don't pile up background work across the test process.
vi.mock('@/lib/customer-debt-context', () => ({
  buildCustomerDebtContext: vi.fn().mockImplementation(async () => mockContext),
}))

vi.mock('@/lib/customer-context-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/customer-context-engine')
  return {
    ...actual,
    buildCustomer360Context: vi.fn().mockImplementation(async () => ({
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: null, portfolio_category: null, company_key: null, debts: [{ id: 'd1', status: 'active' }] }],
      allDisputes: [], customerDataByPortfolio: {},
    })),
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

function baseContext(): any {
  return {
    verified_customer_data: { customer_name: 'محمد العتيبي' },
    verified_debt_data: { current_balance: 1000, currency: 'SAR', creditor_name: 'بنك الاختبار', reference_number: 'REF-1', status: 'active', portfolio_category: 'finance' },
    recent_messages: [
      { direction: 'outbound', content: 'متى تتوقع تسدد أول دفعة؟' },
    ],
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: {},
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockContext = baseContext()
  mockModelContent = JSON.stringify({
    shouldReply: true, action: 'negotiate', reason: 'model_missed_it',
    message: 'متى تتوقع تسدد؟', promised_date: null,
  })
})

// Each entry: a message template with {W} as the spot to substitute, and the
// two common spellings of the SAME timing word that must behave identically.
const SPELLING_VARIANT_PAIRS: { label: string; template: string; variantA: string; variantB: string }[] = [
  { label: 'بداية ↔ بدايه', template: 'بسدد {W} الشهر', variantA: 'بداية', variantB: 'بدايه' },
  { label: 'نهاية ↔ نهايه', template: 'بسدد {W} الشهر', variantA: 'نهاية', variantB: 'نهايه' },
  { label: 'الجمعة ↔ الجمعه', template: 'بسدد يوم {W}', variantA: 'الجمعة', variantB: 'الجمعه' },
  { label: 'الأسبوع ↔ الاسبوع', template: 'بسدد نهاية {W}', variantA: 'الأسبوع', variantB: 'الاسبوع' },
  { label: 'أول ↔ اول', template: 'بسدد {W} الشهر', variantA: 'أول', variantB: 'اول' },
  { label: 'آخر ↔ اخر', template: 'بسدد {W} الشهر', variantA: 'آخر', variantB: 'اخر' },
]

describe('Temporal spelling variants — both spellings produce the SAME outcome', () => {
  for (const { label, template, variantA, variantB } of SPELLING_VARIANT_PAIRS) {
    describe(label, () => {
      it(`"${variantA}" (canonical spelling) → record_promise`, async () => {
        const message = template.replace('{W}', variantA)
        const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message })
        expect(d.action).toBe('record_promise')
        expect(d.reason).toBe('promise_forced_from_temporal_ref')
      })

      it(`"${variantB}" (common WhatsApp misspelling) → record_promise too`, async () => {
        const message = template.replace('{W}', variantB)
        const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message })
        expect(d.action).toBe('record_promise')
        expect(d.reason).toBe('promise_forced_from_temporal_ref')
      })
    })
  }
})

describe('Negative control — no real temporal reference still never records a promise, regardless of spelling-variant handling', () => {
  const noTimingMessages = [
    'إذا تيسرت بسدد',
    'ان شاء الله قريب',
    'بحاول قريب',
    'بسدد بس ما اعرف متى',
  ]
  for (const message of noTimingMessages) {
    it(`"${message}" → negotiate, not record_promise`, async () => {
      const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message })
      expect(d.action).not.toBe('record_promise')
      expect(d.promised_date).toBeNull()
    })
  }
})
