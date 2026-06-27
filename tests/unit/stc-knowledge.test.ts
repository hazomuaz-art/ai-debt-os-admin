import { describe, it, expect } from 'vitest'
import { classifyStcServiceType, STC_FIELD_EXPLANATIONS, renderStcKnowledgeForCaseFile } from '@/lib/stc-knowledge'
import { buildCaseFile } from '@/lib/ai-collector-agent'

describe('classifyStcServiceType — first-digit rule', () => {
  it('a number starting with 5 is mobile', () => {
    expect(classifyStcServiceType('500123456')).toBe('mobile')
  })

  it('a number starting with 1 is landline/home internet', () => {
    expect(classifyStcServiceType('100123456')).toBe('landline_internet')
  })

  it('a number starting with 8 is a data SIM', () => {
    expect(classifyStcServiceType('800123456')).toBe('data_sim')
  })

  it('an unrecognised first digit returns null, never guessed', () => {
    expect(classifyStcServiceType('900123456')).toBeNull()
  })

  it('missing/empty input returns null', () => {
    expect(classifyStcServiceType(null)).toBeNull()
    expect(classifyStcServiceType('')).toBeNull()
  })
})

describe('STC_FIELD_EXPLANATIONS — plain-language field semantics', () => {
  it('explains account_number as distinct from the service number', () => {
    expect(STC_FIELD_EXPLANATIONS.account_number).toContain('رقم الحساب')
    expect(STC_FIELD_EXPLANATIONS.account_number).toContain('يختلف عن رقم الخدمة')
  })

  it('explains product_number (service number)', () => {
    expect(STC_FIELD_EXPLANATIONS.product_number).toContain('رقم الخدمة')
  })

  it('explains baqa_flag as device-bundling status', () => {
    expect(STC_FIELD_EXPLANATIONS.baqa_flag).toContain('جهاز')
  })
})

describe('renderStcKnowledgeForCaseFile — case file injection', () => {
  it('infers mobile service type and "with device" from a full STC row', () => {
    const block = renderStcKnowledgeForCaseFile({
      account_number: 'ACC123', product_number: '5xxxxxxxx', baqa_flag: 'YES',
      customer_established_dt: '2020-01-01', account_status_date: '2026-01-01',
    })
    expect(block).toContain('جوال')
    expect(block).toContain('مرتبطة بجهاز')
  })

  it('"NO" baqa_flag renders as without a device', () => {
    const block = renderStcKnowledgeForCaseFile({ product_number: '1xxxxxxxx', baqa_flag: 'NO' })
    expect(block).toContain('بدون جهاز')
  })

  it('returns empty string for a non-STC/null row', () => {
    expect(renderStcKnowledgeForCaseFile(null)).toBe('')
  })
})

describe('buildCaseFile — STC knowledge block is opt-in via the stcRow param', () => {
  const baseCtx = {
    debt: { creditor_name: 'STC', current_balance: 500, currency: 'SAR', metadata: { extra: {} } },
    collection_account: null,
  }

  it('includes the STC knowledge block when an stcRow is passed', () => {
    const caseFile = buildCaseFile(baseCtx, { product_number: '500111222', baqa_flag: 'YES' })
    expect(caseFile).toContain('معرفة تشغيلية خاصة بـ STC')
    expect(caseFile).toContain('جوال')
  })

  it('omits the STC knowledge block entirely for non-STC portfolios (no stcRow passed)', () => {
    const caseFile = buildCaseFile(baseCtx)
    expect(caseFile).not.toContain('معرفة تشغيلية خاصة بـ STC')
  })

  it('other portfolios are never affected even if called with a null stcRow explicitly', () => {
    const caseFile = buildCaseFile({ debt: { creditor_name: 'Tawuniya', current_balance: 100, currency: 'SAR' }, collection_account: null }, null)
    expect(caseFile).not.toContain('معرفة تشغيلية خاصة بـ STC')
  })
})
