// Real production incident (customer حذيفه, Mobily debt, 2026-06-29): the
// customer said "والله ما اتزكر اني اخدت شي" (a vague expression of doubt —
// no reason given, no explicit objection), and the model recorded
// record_dispute on the very first such message. The deterministic guard
// that was supposed to prevent this only fired when intent==='DISPUTE', but
// this message never tripped any DISPUTE-intent signal (it doesn't match
// dispute/deniesDebt/angry/wrongNumber keywords), so intent stayed GENERAL
// and the guard never engaged at all — letting record_dispute through
// completely ungoverned. Fixed: the guard now applies regardless of intent,
// and disputeReasonGiven also recognizes an EXPLICIT dispute declaration
// (not just a specific reason), so a real "أنا معترض على هذا المبلغ" is
// still allowed through.
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockModelContent = ''
let mockContext: any = {}

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({
      choices: [{ message: { content: mockModelContent } }],
    })) } },
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
    verified_debt_data: { current_balance: 789.47, currency: 'SAR', creditor_name: 'موبايلي', reference_number: 'REF-1', status: 'overdue', portfolio_category: 'telecom' },
    recent_messages: recentMessages,
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: { metadata: {} },
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
})

describe('Real incident — dispute recorded from a vague message with no actual objection', () => {
  it('blocks record_dispute and forces a clarifying question when the customer only expressed vague doubt (no reason, no explicit dispute statement)', async () => {
    mockContext = baseContext([
      { direction: 'outbound', content: 'مديونية على خط Postpaid، المبلغ 789.47 ريال.' },
    ])
    // The real model output that actually shipped to the customer in
    // production for this exact message.
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_dispute', reason: 'customer denies',
      message: 'بسجّل اعتراضك. تقدر تتواصل مع موبايلي مباشرة للتحقق من بيانات الحساب.',
    })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'والله ما اتزكر اني اخدت شي' })

    expect(d.action).toBe('request_clarification')
    expect(d.reason).toBe('dispute_reason_guard_override')
    expect(d.action).not.toBe('record_dispute')
  })

  it('allows record_dispute through when the customer EXPLICITLY states they are disputing/objecting, even without elaborating a specific reason', async () => {
    mockContext = baseContext([
      { direction: 'outbound', content: 'الوعد مسجّل في النظام بتاريخ 2 يوليو.' },
    ])
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_dispute', reason: 'explicit dispute',
      message: 'عندك اعتراض مسجّل عندنا قيد المراجعة الحين.',
    })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'انا معترض علي ذا المبلغ من الاساس' })

    expect(d.action).toBe('record_dispute')
    expect(d.reason).not.toBe('dispute_reason_guard_override')
  })

  it('still allows record_dispute when a SPECIFIC reason is given (existing behavior preserved)', async () => {
    mockContext = baseContext([
      { direction: 'outbound', content: 'المبلغ المستحق 789.47 ريال.' },
    ])
    mockModelContent = JSON.stringify({
      shouldReply: true, action: 'record_dispute', reason: 'specific reason',
      message: 'تمام، بسجّل اعتراضك بخصوص المبلغ.',
    })

    // Was "هذا رقم غلط مو رقمي" — that phrase is a genuine wrong-number claim
    // ("مو رقمي" = "not my number"), correctly routed to the dedicated
    // record_wrong_number guard now instead (see agent-guards.test.ts "Wrong-
    // number handling"). Using a dispute-about-the-amount phrasing here keeps
    // this test testing what it always meant to: a specific-reason DEBT
    // dispute, not a phone-number claim.
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'المبلغ غلط، هذا مو المبلغ الصحيح اللي علي' })

    expect(d.action).toBe('record_dispute')
  })
})
