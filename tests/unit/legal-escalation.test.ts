import { describe, it, expect } from 'vitest'
import { detectMandatoryEscalation, renderLegalPersonaReply } from '@/lib/legal-escalation'

describe('detectMandatoryEscalation — deterministic, no guessing', () => {
  it('detects a lawyer mention regardless of sector', () => {
    const r = detectMandatoryEscalation({ text: 'بكلم محاميي', isInsurancePortfolio: false })
    expect(r?.escalation_type).toBe('lawyer_mention')
  })

  it('detects a legal/court threat', () => {
    const r = detectMandatoryEscalation({ text: 'برفع عليك دعوى قضائية', isInsurancePortfolio: false })
    expect(r?.escalation_type).toBe('legal_threat')
  })

  it('detects an official complaint', () => {
    const r = detectMandatoryEscalation({ text: 'برفع شكوى رسمية عليكم', isInsurancePortfolio: false })
    expect(r?.escalation_type).toBe('complaint')
  })

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

  it('lawyer mention takes priority and is checked before insurance signals', () => {
    const objection = { objectsToRecourseOrFault: true, contradictsClaimReason: false }
    const r = detectMandatoryEscalation({ text: 'بكلم محاميي بخصوص نسبة الخطأ', isInsurancePortfolio: true, insuranceObjection: objection as any, insuranceCase: { claim_type: 'recourse' } as any })
    expect(r?.escalation_type).toBe('lawyer_mention')
  })
})

describe('custom escalation_rules from a portfolio Playbook — additive only', () => {
  it('triggers playbook_mandated when a custom keyword matches, checked only after the hard-coded rules', () => {
    const rules = [{ keywords: ['وسيط', 'محامي الأسرة'], reason: 'وسيط قانوني غير معتاد' }]
    const r = detectMandatoryEscalation({ text: 'بكلم وسيط بخصوص الموضوع', isInsurancePortfolio: false, customEscalationRules: rules })
    expect(r?.escalation_type).toBe('playbook_mandated')
    expect(r?.reason).toBe('وسيط قانوني غير معتاد')
  })

  it('hard-coded rules still win even if a custom rule would also match', () => {
    const rules = [{ keywords: ['محامي'], reason: 'custom reason should NOT be used' }]
    const r = detectMandatoryEscalation({ text: 'بكلم محاميي', isInsurancePortfolio: false, customEscalationRules: rules })
    expect(r?.escalation_type).toBe('lawyer_mention') // the fixed rule, not the custom one
  })

  it('does not escalate when no custom rule and no hard-coded signal match', () => {
    const rules = [{ keywords: ['شيء غير موجود في الرسالة'], reason: 'x' }]
    const r = detectMandatoryEscalation({ text: 'تمام بسدد بكرة', isInsurancePortfolio: false, customEscalationRules: rules })
    expect(r).toBeNull()
  })

  it('an empty/missing customEscalationRules never crashes or escalates', () => {
    expect(detectMandatoryEscalation({ text: 'تمام بسدد بكرة', isInsurancePortfolio: false, customEscalationRules: [] })).toBeNull()
    expect(detectMandatoryEscalation({ text: 'تمام بسدد بكرة', isInsurancePortfolio: false })).toBeNull()
  })
})

describe('renderLegalPersonaReply', () => {
  it('always identifies as "إدارة الشؤون القانونية" and never offers negotiation', () => {
    const msg = renderLegalPersonaReply('lawyer_mention')
    expect(msg).toContain('إدارة الشؤون القانونية')
    expect(msg).not.toMatch(/خصم|تقسيط|وعد|سدد|بكرة/)
  })
})
