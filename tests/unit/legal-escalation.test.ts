import { describe, it, expect } from 'vitest'
import { detectMandatoryEscalation, renderLegalPersonaReply, detectStcReviewSignal } from '@/lib/legal-escalation'

// 🔴 lawyer_mention/legal_threat/complaint used to be detected here by raw
// keyword matching on the customer's text ("محامي"/"محكمة"/"شكوى رسمية").
// Real production incident (customer RAYMOND LASTRELLA BLANCAFLOR,
// 2026-07-08): a customer pasted/forwarded an SMS notice WE sent (which
// itself mentions "المحامي") and got treated as if they personally
// threatened legal action — the keyword check has no way to tell "the
// customer is quoting text we sent them" from "the customer genuinely means
// this". That detection now lives in ai-collector-agent.ts as the model's
// own semantic verdict (parsed.legal_escalation_trigger) — see
// tests/unit/agent-guards.test.ts "(HH)"/"(HH2)" and
// tests/unit/agent-corrective-regeneration.test.ts for coverage of that
// behavior. detectMandatoryEscalation itself now only handles the
// insurance-engine-driven and playbook-configured triggers below, which are
// data/config-driven rather than keyword-matched against free-form text.
describe('detectMandatoryEscalation — insurance + playbook triggers only (lawyer/legal/complaint moved to the model)', () => {
  it('does NOT escalate ordinary negotiation text', () => {
    const r = detectMandatoryEscalation({ text: 'تمام بسدد بكرة', isInsurancePortfolio: false })
    expect(r).toBeNull()
  })

  it('insurance objection types ONLY ever fire for an insurance portfolio', () => {
    const objection = { objectsToRecourseOrFault: true, contradictsClaimReason: false }
    const nonIns = detectMandatoryEscalation({ text: 'اعتراض على نسبة الخطأ', isInsurancePortfolio: false, insuranceObjection: objection as any })
    expect(nonIns).toBeNull() // must stay null for non-insurance even with the same signal
    const ins = detectMandatoryEscalation({ text: 'اعتراض على نسبة الخطأ', isInsurancePortfolio: true, insuranceObjection: objection as any, insuranceCase: { claim_type: 'recourse' } as any })
    expect(ins?.escalation_type).toBe('recourse_dispute')
  })

  it('classifies third_party vs recourse correctly from the Insurance Engine claim_type', () => {
    const objection = { objectsToRecourseOrFault: true, contradictsClaimReason: false }
    const tp = detectMandatoryEscalation({ text: 'اعتراض', isInsurancePortfolio: true, insuranceObjection: objection as any, insuranceCase: { claim_type: 'third_party' } as any })
    expect(tp?.escalation_type).toBe('third_party_dispute')
  })

  it('counter-evidence claim -> recovered_deduction regardless of claim_type', () => {
    const objection = { objectsToRecourseOrFault: false, contradictsClaimReason: true }
    const r = detectMandatoryEscalation({ text: 'عندي رخصة سارية وبترسلها', isInsurancePortfolio: true, insuranceObjection: objection as any, insuranceCase: { claim_type: 'recourse' } as any })
    expect(r?.escalation_type).toBe('recovered_deduction')
  })
})

describe('custom escalation_rules from a portfolio Playbook — additive only', () => {
  it('triggers playbook_mandated when a custom keyword matches', () => {
    const rules = [{ keywords: ['وسيط', 'محامي الأسرة'], reason: 'وسيط قانوني غير معتاد' }]
    const r = detectMandatoryEscalation({ text: 'بكلم وسيط بخصوص الموضوع', isInsurancePortfolio: false, customEscalationRules: rules })
    expect(r?.escalation_type).toBe('playbook_mandated')
    expect(r?.reason).toBe('وسيط قانوني غير معتاد')
  })

  it('does not escalate when no custom rule and no insurance signal match', () => {
    const rules = [{ keywords: ['شيء غير موجود في الرسالة'], reason: 'x' }]
    const r = detectMandatoryEscalation({ text: 'تمام بسدد بكرة', isInsurancePortfolio: false, customEscalationRules: rules })
    expect(r).toBeNull()
  })

  it('an empty/missing customEscalationRules never crashes or escalates', () => {
    expect(detectMandatoryEscalation({ text: 'تمام بسدد بكرة', isInsurancePortfolio: false, customEscalationRules: [] })).toBeNull()
    expect(detectMandatoryEscalation({ text: 'تمام بسدد بكرة', isInsurancePortfolio: false })).toBeNull()
  })
})

describe('suppressLegalTriggers — STC policy bans the legal/lockout path entirely', () => {
  it('a playbook-mandated custom rule is refused when suppressed, even if configured', () => {
    const rules = [{ keywords: ['محامي'], reason: 'should never fire for STC' }]
    const r = detectMandatoryEscalation({ text: 'بكلم محاميي', isInsurancePortfolio: false, customEscalationRules: rules, suppressLegalTriggers: true })
    expect(r).toBeNull()
  })

  it('a playbook-mandated custom rule still fires normally when NOT suppressed', () => {
    const rules = [{ keywords: ['محامي'], reason: 'real custom trigger' }]
    const r = detectMandatoryEscalation({ text: 'بكلم محاميي', isInsurancePortfolio: false, customEscalationRules: rules, suppressLegalTriggers: false })
    expect(r?.escalation_type).toBe('playbook_mandated')
  })

  it('insurance-driven triggers are unaffected by suppressLegalTriggers (STC has no insurance portfolios anyway, but the code path is independent)', () => {
    const objection = { objectsToRecourseOrFault: true, contradictsClaimReason: false }
    const r = detectMandatoryEscalation({ text: 'اعتراض', isInsurancePortfolio: true, insuranceObjection: objection as any, insuranceCase: { claim_type: 'recourse' } as any, suppressLegalTriggers: true })
    expect(r?.escalation_type).toBe('recourse_dispute')
  })
})

describe('detectStcReviewSignal — non-freezing complaint signal', () => {
  it('"أشتكي على STC" is detected as a customer_complaint', () => {
    const r = detectStcReviewSignal('أشتكي على STC')
    expect(r?.escalation_type).toBe('customer_complaint')
  })

  it('legal/lawyer language is NOT picked up as a complaint signal', () => {
    expect(detectStcReviewSignal('سأكلم محامي')).toBeNull()
    expect(detectStcReviewSignal('برفع عليك قضية')).toBeNull()
  })

  it('ordinary negotiation text does not trigger anything', () => {
    expect(detectStcReviewSignal('تمام بسدد بكرة')).toBeNull()
  })
})

describe('renderLegalPersonaReply', () => {
  it('always identifies as "إدارة الشؤون القانونية" and never offers negotiation', () => {
    const msg = renderLegalPersonaReply('lawyer_mention')
    expect(msg).toContain('إدارة الشؤون القانونية')
    expect(msg).not.toMatch(/خصم|تقسيط|وعد|سدد|بكرة/)
  })
})
