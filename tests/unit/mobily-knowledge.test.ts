import { describe, it, expect } from 'vitest'
import {
  classifyMobilyServiceStatus,
  resolveMobilyPaymentNumber,
  detectMobilyFieldMeaningQuestion,
  renderMobilyKnowledgeForCaseFile,
  MOBILY_FIELD_EXPLANATIONS,
} from '@/lib/mobily-knowledge'
import { buildCaseFile } from '@/lib/ai-collector-agent'

describe('classifyMobilyServiceStatus', () => {
  it('Closed → closed (full disconnect)', () => {
    expect(classifyMobilyServiceStatus('Closed')).toBe('closed')
    expect(classifyMobilyServiceStatus('مغلق')).toBe('closed')
  })
  it('Inactive → inactive (temporary disconnect)', () => {
    expect(classifyMobilyServiceStatus('Inactive')).toBe('inactive')
    expect(classifyMobilyServiceStatus('غير نشط')).toBe('inactive')
  })
  it('unknown/missing → null, never guessed', () => {
    expect(classifyMobilyServiceStatus('Active')).toBeNull()
    expect(classifyMobilyServiceStatus('')).toBeNull()
    expect(classifyMobilyServiceStatus(null)).toBeNull()
  })
})

describe('resolveMobilyPaymentNumber — status-based, safety-critical', () => {
  it('Inactive → the Service Number (product_number)', () => {
    const r = resolveMobilyPaymentNumber({ service_status: 'Inactive', product_number: '0551112222', account_number: 'ACC-9' })
    expect(r).toEqual({ kind: 'service_number', value: '0551112222' })
  })
  it('Closed → the Account Number', () => {
    const r = resolveMobilyPaymentNumber({ service_status: 'Closed', product_number: '0551112222', account_number: 'ACC-9' })
    expect(r).toEqual({ kind: 'account_number', value: 'ACC-9' })
  })
  it('unknown status → null (never asserts a number)', () => {
    expect(resolveMobilyPaymentNumber({ service_status: 'Active', product_number: '055', account_number: 'ACC' })).toBeNull()
  })
  it('correct status but the needed number missing → null', () => {
    expect(resolveMobilyPaymentNumber({ service_status: 'Inactive', account_number: 'ACC' })).toBeNull()
  })
})

describe('detectMobilyFieldMeaningQuestion', () => {
  it('detects payment/field questions', () => {
    expect(detectMobilyFieldMeaningQuestion('وش رقم الخدمة؟')).toBe(true)
    expect(detectMobilyFieldMeaningQuestion('وين رقم السداد')).toBe(true)
    expect(detectMobilyFieldMeaningQuestion('ايش حالة الخدمة')).toBe(true)
  })
  it('ignores unrelated text', () => {
    expect(detectMobilyFieldMeaningQuestion('السلام عليكم')).toBe(false)
  })
})

describe('MOBILY_FIELD_EXPLANATIONS', () => {
  it('explains service status meanings (Closed/Inactive)', () => {
    expect(MOBILY_FIELD_EXPLANATIONS.service_status).toContain('فصل كلي')
    expect(MOBILY_FIELD_EXPLANATIONS.service_status).toContain('فصل مؤقت')
  })
})

describe('renderMobilyKnowledgeForCaseFile', () => {
  it('Inactive row surfaces the service number as the correct payment number', () => {
    const block = renderMobilyKnowledgeForCaseFile({ service_status: 'Inactive', product_number: '0551112222', account_number: 'ACC-9' })
    expect(block).toContain('Inactive')
    expect(block).toContain('رقم الخدمة')
    expect(block).toContain('0551112222')
    expect(block).toContain('فصل مؤقت')
  })
  it('Closed row surfaces the account number as the correct payment number', () => {
    const block = renderMobilyKnowledgeForCaseFile({ service_status: 'Closed', product_number: '0551112222', account_number: 'ACC-9' })
    expect(block).toContain('Closed')
    expect(block).toContain('رقم الحساب')
    expect(block).toContain('ACC-9')
  })
  it('null row → empty string', () => {
    expect(renderMobilyKnowledgeForCaseFile(null)).toBe('')
  })
})

describe('buildCaseFile — Mobily knowledge + sadad payment-block suppression', () => {
  const baseCtx = {
    debt: { creditor_name: 'موبايلي', current_balance: 300, currency: 'SAR', metadata: { extra: { sadad_number: '700111' } } },
    collection_account: null,
  }

  it('injects the Mobily knowledge block when a mobilyRow is passed', () => {
    const cf = buildCaseFile(baseCtx, null, { service_status: 'Inactive', product_number: '0551112222' })
    expect(cf).toContain('معرفة تشغيلية خاصة بموبايلي')
    expect(cf).toContain('0551112222')
  })

  it('suppresses the generic SADAD payment-method block for Mobily (no conflicting payment number)', () => {
    const cf = buildCaseFile(baseCtx, null, { service_status: 'Inactive', product_number: '0551112222' })
    expect(cf).not.toContain('مصدر الدفع المعتمد الوحيد')
  })

  it('a non-Mobily case file (no mobilyRow) keeps the generic SADAD payment block and no Mobily section', () => {
    const cf = buildCaseFile(baseCtx)
    expect(cf).toContain('مصدر الدفع المعتمد الوحيد') // generic sadad block still fires
    expect(cf).not.toContain('معرفة تشغيلية خاصة بموبايلي')
  })
})
