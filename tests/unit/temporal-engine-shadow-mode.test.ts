import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the Temporal Intelligence Engine's promotion from Shadow Mode to
// the LIVE, authoritative date resolver (2026-06-28):
//   1) when the engine resolves a date, that date is what actually gets
//      stored/returned — not the model's own guess, not the generic
//      "+3 days" fallback.
//   2) the engine can catch a promise the simple lexicon (hasTemporalRef)
//      misses entirely (e.g. a holiday-only expression).
//   3) an engine failure (throws) never breaks the reply — falls back
//      gracefully to the model's date or the generic fallback.
//   4) a non-temporal, non-commitment message never even calls the engine.

let mockModelContent = ''
let mockContext: any = {}
let mockEngineResolution: any = null
let mockEngineShouldThrow = false

const logCalls: { level: string; message: string; context?: any }[] = []
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: (message: string, context?: any) => logCalls.push({ level: 'debug', message, context }),
    info: (message: string, context?: any) => logCalls.push({ level: 'info', message, context }),
    warn: (message: string, context?: any) => logCalls.push({ level: 'warn', message, context }),
    error: (message: string, _err?: any, context?: any) => logCalls.push({ level: 'error', message, context }),
  }),
}))

vi.mock('@/lib/temporal-engine', async () => {
  const actual = await vi.importActual<any>('@/lib/temporal-engine')
  return {
    ...actual,
    resolveTemporalExpression: vi.fn().mockImplementation(async () => {
      if (mockEngineShouldThrow) throw new Error('engine boom')
      return mockEngineResolution
    }),
  }
})

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn().mockImplementation(async () => ({ choices: [{ message: { content: mockModelContent } }] })) } },
  })),
}))

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

// Real bug this fixes: every test in this file called runCollectorAgent
// without messageTimestamp, so `todayStr` inside the agent defaulted to the
// REAL wall-clock date (see ai-collector-agent.ts's own comment: "e.g. a
// test fixing 'today' for determinism" — messageTimestamp exists precisely
// for this). Once real time passed the mocked resolved_date used in one
// test ('2026-07-05'), isSaneDate() started rejecting it as "in the past"
// and silently fell through to the generic +3-day fallback, making the test
// fail with an ever-growing date drift depending on which day it happened
// to run. Pinning a fixed reference "now" makes every test's notion of
// "today" deterministic regardless of when the suite actually runs.
const FIXED_NOW = '2026-06-29T09:00:00Z'

function baseContext(): any {
  return {
    verified_customer_data: { customer_name: 'محمد العتيبي' },
    verified_debt_data: { current_balance: 1000, currency: 'SAR', creditor_name: 'بنك الاختبار', reference_number: 'REF-1', status: 'active', portfolio_category: 'finance' },
    recent_messages: [{ direction: 'outbound', content: 'متى تتوقع تسدد؟' }],
    recent_promises: [], recent_approvals: [], recent_payments: [],
    strict_rules: [], negotiation_profile: {},
    latest_collection_context: { last_followup: null, last_status_change: null },
    collection_account: null, customer: { notes: null }, debt: {},
  }
}

function defaultEngineResolution(overrides: Partial<any> = {}): any {
  return {
    resolved: true, resolved_date: '2026-07-01', resolved_time: null,
    confidence: 'high', reference_type: 'month_reference', source_expression: 'بداية الشهر',
    calendar_type: 'gregorian', requires_customer_data: false, requires_company_policy: false,
    requires_calendar: false, needs_clarification: false, clarification_reason: null,
    original_resolved_date: null, business_day_adjusted: false,
    explanation: { matched_rule: 'month_reference:test', rule_priority_level: 6, data_sources_used: [], data_sources_available_but_unused: [], confidence_reason: 'test', business_day_adjustment: { applied: false, rule: 'keep_as_is' }, alternative_interpretations: [] },
    engine_version: '1.0.0', kb_version: 'sa-test.1', learning_logged: false,
    ...overrides,
  }
}

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'sk-test'
  mockContext = baseContext()
  mockEngineResolution = defaultEngineResolution()
  mockEngineShouldThrow = false
  logCalls.length = 0
})

describe('Temporal Engine — LIVE, authoritative date resolution', () => {
  it('the resolved date from the engine is what actually gets stored/returned, overriding the generic fallback', async () => {
    mockEngineResolution = defaultEngineResolution({ resolved_date: '2026-07-05' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر', messageTimestamp: FIXED_NOW })

    expect(d.action).toBe('record_promise')
    expect(d.promised_date).toBe('2026-07-05')
  })

  it('the engine date OVERRIDES a different, sane date the model guessed on its own', async () => {
    mockEngineResolution = defaultEngineResolution({ resolved_date: '2026-08-15' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'record_promise', reason: 'x', message: 'تمام', promised_date: '2026-07-20', promise_text: 'بداية الشهر' })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر', messageTimestamp: FIXED_NOW })

    expect(d.promised_date).toBe('2026-08-15') // engine wins, not the model's 2026-07-20
  })

  it('catches a promise the simple lexicon misses entirely (holiday expression) and resolves its date', async () => {
    mockEngineResolution = defaultEngineResolution({ reference_type: 'holiday', resolved_date: '2026-12-24', confidence: 'medium' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بعد العيد', messageTimestamp: FIXED_NOW })

    expect(d.action).toBe('record_promise')
    expect(d.promised_date).toBe('2026-12-24')
  })

  it('an engine that THROWS never breaks the reply — falls back to the generic +3-day checkpoint', async () => {
    mockEngineShouldThrow = true
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر', messageTimestamp: FIXED_NOW })

    expect(d.action).toBe('record_promise')
    expect(d.promised_date).toBeTruthy() // still got a date, just not the engine's
    expect(logCalls.some(c => c.level === 'warn' && c.message.includes('Temporal Engine resolution failed'))).toBe(true)
  })

  it('when the engine cannot resolve (needs_clarification), falls back to the model/generic date instead of breaking', async () => {
    mockEngineResolution = defaultEngineResolution({ resolved: false, resolved_date: null, confidence: null, needs_clarification: true, clarification_reason: 'ambiguous_or_reference' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر', messageTimestamp: FIXED_NOW })

    expect(d.action).toBe('record_promise')
    expect(d.promised_date).toBeTruthy()
  })

  it('a plain non-temporal, non-commitment message never calls the engine at all', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام', promised_date: null })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش الشركة؟', messageTimestamp: FIXED_NOW })

    expect(logCalls.some(c => c.message.includes('Temporal Engine'))).toBe(false)
  })

  it('gov programs (e.g. حساب المواطن) resolve via the engine, with hasTemporalRef now also recognizing them deterministically', async () => {
    mockEngineResolution = defaultEngineResolution({ reference_type: 'gov_program', resolved_date: '2026-07-10', confidence: 'medium' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بعد حساب المواطن', messageTimestamp: FIXED_NOW })

    expect(d.action).toBe('record_promise')
    expect(d.promised_date).toBe('2026-07-10')
  })
})
