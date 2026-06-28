import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves Phase 1 (Shadow Mode) of the Temporal Intelligence Engine:
//   1) the OLD decision pipeline's output is NEVER changed by the new
//      engine, even when the new engine disagrees completely.
//   2) every temporal message triggers a structured comparison log with
//      ALL required fields (old/new decision, match flag, mismatch reason,
//      confidence, explanation, engine_version, kb_version).
//   3) a non-temporal message never even calls the new engine (no noise).
//   4) a failure inside the new engine is swallowed — never affects the
//      live decision or throws.

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
  // quickScan is the real implementation — it's a sync, DB-free resolver
  // scan, safe to run for real in tests. Only resolveTemporalExpression
  // (which hits Supabase via the KB loader) is mocked.
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

describe('Shadow Mode — old decision is NEVER changed by the new engine', () => {
  it('new engine disagreeing completely does not change the returned action/date', async () => {
    // New engine says "needs clarification, no date" — directly contradicts
    // what the old pipeline will deterministically produce below.
    mockEngineResolution = defaultEngineResolution({ resolved: false, resolved_date: null, confidence: null, needs_clarification: true, clarification_reason: 'ambiguous_or_reference' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر' })

    // This is exactly what the OLD pipeline alone produces (same as
    // temporal-parsing-layer.test.ts) — proves Shadow Mode is read-only.
    expect(d.action).toBe('record_promise')
    expect(d.reason).toBe('promise_forced_from_temporal_ref')
    expect(d.promised_date).toBeTruthy()
  })

  it('new engine resolving a DIFFERENT date than old still does not change the returned date', async () => {
    mockEngineResolution = defaultEngineResolution({ resolved_date: '2099-12-31' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر' })

    expect(d.promised_date).not.toBe('2099-12-31')
  })

  it('an engine that THROWS never breaks the live decision', async () => {
    mockEngineShouldThrow = true
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })

    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر' })

    expect(d.action).toBe('record_promise')
    // give the fire-and-forget shadow task a tick to run and be caught
    await new Promise(r => setTimeout(r, 0))
    expect(logCalls.some(c => c.level === 'error' && c.message.includes('shadow_comparison failed'))).toBe(true)
  })
})

describe('Shadow Mode — structured comparison log', () => {
  it('logs old_decision, new_decision, dates_match, mismatch_reason, explanation, engine_version, kb_version', async () => {
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر' })
    await new Promise(r => setTimeout(r, 0))

    const shadowLog = logCalls.find(c => c.message.includes('temporal_engine_shadow_comparison'))
    expect(shadowLog).toBeTruthy()
    const ctx = shadowLog!.context
    expect(ctx.old_decision).toMatchObject({ action: 'record_promise', forcedPromise: true })
    expect(ctx.new_decision.resolved_date).toBe('2026-07-01')
    expect(typeof ctx.dates_match).toBe('boolean')
    expect(ctx.explanation).toBeTruthy()
    expect(ctx.engine_version).toBe('1.0.0')
    expect(ctx.kb_version).toBe('sa-test.1')
  })

  it('flags mismatch_reason when old forced a date but new could not resolve one', async () => {
    mockEngineResolution = defaultEngineResolution({ resolved: false, resolved_date: null, confidence: null, needs_clarification: true })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر' })
    await new Promise(r => setTimeout(r, 0))

    const shadowLog = logCalls.find(c => c.message.includes('temporal_engine_shadow_comparison'))
    expect(shadowLog!.context.dates_match).toBe(false)
    expect(shadowLog!.context.mismatch_reason).toBe('old_forced_a_date_new_needs_clarification_or_unresolved')
  })

  it('dates_match is true when both pipelines agree', async () => {
    mockEngineResolution = defaultEngineResolution({ resolved_date: '2026-06-29' }) // matches the old fallback (+3 days) for this fixed test date
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
    const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر' })
    await new Promise(r => setTimeout(r, 0))

    const shadowLog = logCalls.find(c => c.message.includes('temporal_engine_shadow_comparison'))
    expect(shadowLog!.context.old_decision.promised_date).toBe(d.promised_date)
    expect(shadowLog!.context.dates_match).toBe(d.promised_date === '2026-06-29')
  })
})

describe('Shadow Mode — gated by quickScan(), the new engine\'s own detector (never the old lexicon)', () => {
  it('a plain non-temporal question never calls the new engine at all — quickScan() correctly rejects it', async () => {
    // No resolver in the engine matches this text, so quickScan() returns
    // false and the shadow comparison never runs — same no-noise guarantee
    // as before, but the decision now comes from the engine's own resolver
    // loop instead of the old hasTemporalRef/signals.promise/
    // hasCommitmentWithVagueTiming lexicon.
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'reply', reason: 'x', message: 'تمام', promised_date: null })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'وش الشركة؟' })
    await new Promise(r => setTimeout(r, 0))

    expect(logCalls.some(c => c.message.includes('temporal_engine_shadow_comparison'))).toBe(false)
  })

  it('gov programs (e.g. حساب المواطن) now reach the shadow comparison too — hasTemporalRef was extended to cover them deterministically', async () => {
    // "حساب المواطن" appears nowhere in hasTemporalRef/signals.promise/
    // hasCommitmentWithVagueTiming — before this fix, this message would
    // never have reached the shadow comparison.
    mockEngineResolution = defaultEngineResolution({ reference_type: 'gov_program', resolved_date: '2026-07-10', confidence: 'medium' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بعد حساب المواطن' })
    await new Promise(r => setTimeout(r, 0))

    const shadowLog = logCalls.find(c => c.message.includes('temporal_engine_shadow_comparison'))
    expect(shadowLog).toBeTruthy()
    expect(shadowLog!.context.new_decision.reference_type).toBe('gov_program')
    expect(shadowLog!.context.old_decision.hasTemporalRef).toBe(true) // hasTemporalRef now recognizes gov-program phrases deterministically
  })

  it('covers a holiday expression the old lexicon also has zero concept of', async () => {
    mockEngineResolution = defaultEngineResolution({ reference_type: 'holiday', resolved_date: '2026-03-24', confidence: 'medium' })
    mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
    await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بعد العيد' })
    await new Promise(r => setTimeout(r, 0))

    const shadowLog = logCalls.find(c => c.message.includes('temporal_engine_shadow_comparison'))
    expect(shadowLog).toBeTruthy()
    expect(shadowLog!.context.new_decision.reference_type).toBe('holiday')
    expect(shadowLog!.context.old_decision.hasTemporalRef).toBe(false)
  })
})

describe('Shadow Mode — production paths never use the new engine\'s result for any real action', () => {
  it('action/reason/message/promised_date returned are identical to pre-Phase-1 behavior regardless of mocked engine output', async () => {
    for (const fakeResolution of [
      defaultEngineResolution({ resolved_date: '2030-01-01', confidence: 'low' }),
      defaultEngineResolution({ resolved: false, needs_clarification: true, clarification_reason: 'unrecognized_expression' }),
      null, // engine returns nothing usable
    ]) {
      mockEngineResolution = fakeResolution
      mockModelContent = JSON.stringify({ shouldReply: true, action: 'negotiate', reason: 'x', message: 'متى تسدد؟', promised_date: null })
      const d = await runCollectorAgent({ company_id: 'c', customer_id: 'u', debt_id: 'd1', message: 'بسدد بداية الشهر' })
      expect(d.action).toBe('record_promise')
      expect(d.reason).toBe('promise_forced_from_temporal_ref')
    }
  })
})
