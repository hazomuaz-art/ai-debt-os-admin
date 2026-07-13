import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the new owner-specified feature (2026-06-28): 3+ explicit refusals
// to pay -> after 48h (checked by the legal-escalation-check cron, tested
// separately) -> the debt gets a 'repeated_refusal' escalation, which makes
// ai-collector-agent.ts reply with a DYNAMIC "lawyer persona" message
// (generateLawyerPersonaReply) instead of the fixed renderLegalPersonaReply
// line used by every other escalation type. STC/Saudi Energy/National Water
// portfolios are excluded from the refusal-tracking write entirely.

let mockOpenEscalation: any = null
let mockTrackCalls: any[] = []
let lawyerReplyContent = 'تمام، فهمت — لكن هذا الملف الآن قيد المراجعة القانونية. هل تريد تسوية الآن قبل تصعيد الإجراءات؟'

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function () { return {
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({ choices: [{ message: { content: lawyerReplyContent } }] })) } },
  } }),
}))

vi.mock('@/lib/customer-debt-context', () => ({
  buildCustomerDebtContext: vi.fn().mockImplementation(async () => ({
    verified_customer_data: { customer_name: 'حذيفه' },
    verified_debt_data: { current_balance: 1000, currency: 'SAR', creditor_name: 'إس تي سي', reference_number: 'REF-1', status: 'overdue', portfolio_category: 'telecom' },
    recent_messages: [], recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: { metadata: {} },
  })),
}))

vi.mock('@/lib/customer-context-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/customer-context-engine')
  return {
    ...actual,
    buildCustomer360Context: vi.fn().mockImplementation(async () => ({
      debtGroups: [{ portfolio_id: 'p1', portfolio_name: 'موبايلي', portfolio_category: 'telecom', company_key: 'mobily', debts: [{ id: 'd1', status: 'active' }] }],
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

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockImplementation(() => ({
          maybeSingle: vi.fn().mockImplementation(async () => ({
            data: table === 'debts' ? { current_balance: 1000, currency: 'SAR', reference_number: 'REF-1', portfolio: { name_ar: 'موبايلي', name: 'Mobily' }, metadata: {} } : null,
          })),
        })),
      })),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    })),
  })),
}))

vi.mock('@/lib/legal-escalation', async () => {
  const actual = await vi.importActual<any>('@/lib/legal-escalation')
  return {
    ...actual,
    getOpenEscalation: vi.fn().mockImplementation(async () => mockOpenEscalation),
    openEscalation: vi.fn().mockResolvedValue('esc-1'),
    trackRefusalForLegalEscalation: vi.fn().mockImplementation(async (args: any) => { mockTrackCalls.push(args) }),
  }
})

import { runCollectorAgent } from '@/lib/ai-collector-agent'

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockOpenEscalation = null
  mockTrackCalls = []
})

describe('Repeated-refusal -> lawyer persona escalation', () => {
  it('an explicit refusal is tracked (trackRefusalForLegalEscalation called) for a normal portfolio', async () => {
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ما ابغي اسدد' })
    expect(mockTrackCalls.length).toBe(1)
    expect(mockTrackCalls[0].debt_id).toBe('d1')
  })

  it('once a repeated_refusal escalation is OPEN, the agent replies with the dynamic lawyer-persona message, not the fixed line', async () => {
    mockOpenEscalation = { id: 'esc-1', escalation_type: 'repeated_refusal', reason: 'رفض متكرر (3 مرات)', opened_at: '2026-06-28T00:00:00Z' }
    lawyerReplyContent = 'الملف تحت المراجعة القانونية الآن — هل ترغب بتسوية الموضوع قبل تصعيد الإجراءات؟'

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'ما عندي شي اسويه' })

    expect(d.reason).toBe('legal_escalation_locked_lawyer_persona')
    expect(d.message).toBe(lawyerReplyContent)
    expect(d.message).not.toMatch(/معاك المستشار القانوني للشركة/) // not the fixed line used by other escalation types
  })

  it('STC portfolio is excluded — refusal is never tracked for the lawyer-persona escalation', async () => {
    const { buildCustomer360Context } = await import('@/lib/customer-context-engine')
    ;(buildCustomer360Context as any).mockResolvedValueOnce({
      debtGroups: [{ portfolio_id: 'p2', portfolio_name: 'إس تي سي', portfolio_category: 'telecom', company_key: 'stc', debts: [{ id: 'd2', status: 'active' }] }],
      allDisputes: [], customerDataByPortfolio: {},
    })

    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd2', message: 'ما ابغي اسدد' })

    expect(mockTrackCalls.length).toBe(0)
  })

  it('every OTHER escalation type still uses the old fixed line, unaffected by this change', async () => {
    mockOpenEscalation = { id: 'esc-2', escalation_type: 'lawyer_mention', reason: 'ذكر محامٍ', opened_at: '2026-06-28T00:00:00Z' }

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'أي شيء' })

    expect(d.reason).toBe('legal_escalation_locked')
    expect(d.message).toMatch(/معاك المستشار القانوني للشركة/)
  })
})
