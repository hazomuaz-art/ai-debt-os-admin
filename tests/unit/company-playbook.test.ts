import { describe, it, expect } from 'vitest'
import { renderPlaybookForPrompt, type Playbook } from '@/lib/company-playbook'

function basePlaybook(overrides: Partial<Playbook> = {}): Playbook {
  return {
    portfolio_id: 'p1', category: 'telecom',
    discounts: { allowed: false, max_percent: 0, requires_admin_approval: true },
    installments: { allowed: false, max_months: 0, requires_admin_approval: true },
    fields_to_surface: [], allowed_dispute_types: [], notes: null,
    company_policy: null, ai_instructions: null, forbidden_phrases: [], escalation_rules: [], portfolio_specific_rules: null,
    is_default: false,
    ...overrides,
  }
}

describe('renderPlaybookForPrompt — new real policy fields', () => {
  it('includes company_policy when set', () => {
    const text = renderPlaybookForPrompt(basePlaybook({ company_policy: 'لا تأجيل أكثر من 7 أيام بدون موافقة مدير.' }))
    expect(text).toContain('سياسة الشركة')
    expect(text).toContain('لا تأجيل أكثر من 7 أيام')
  })

  it('includes ai_instructions when set', () => {
    const text = renderPlaybookForPrompt(basePlaybook({ ai_instructions: 'استخدم لقب حضرتك.' }))
    expect(text).toContain('تعليمات خاصة بك')
    expect(text).toContain('استخدم لقب حضرتك')
  })

  it('includes forbidden_phrases as an explicit prohibition list', () => {
    const text = renderPlaybookForPrompt(basePlaybook({ forbidden_phrases: ['بتصعيد قانوني فوري', 'نص المبلغ بدون موافقة'] }))
    expect(text).toContain('ممنوع منعاً باتاً')
    expect(text).toContain('بتصعيد قانوني فوري')
    expect(text).toContain('نص المبلغ بدون موافقة')
  })

  it('includes portfolio_specific_rules when set', () => {
    const text = renderPlaybookForPrompt(basePlaybook({ portfolio_specific_rules: 'عملاء جدد، لا تذكر تاريخ الاستحقاق قبل التعريف.' }))
    expect(text).toContain('قواعد خاصة بهذي المحفظة')
  })

  it('omits all new sections when fields are empty/null — no noise in the prompt', () => {
    const text = renderPlaybookForPrompt(basePlaybook())
    expect(text).not.toContain('سياسة الشركة')
    expect(text).not.toContain('تعليمات خاصة بك')
    expect(text).not.toContain('ممنوع منعاً باتاً قول')
    expect(text).not.toContain('قواعد خاصة بهذي المحفظة')
  })
})
