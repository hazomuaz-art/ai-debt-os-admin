import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the 3 approved fixes to processInboundReceipt:
//   1) SADAD/account-number matching now actually checks the per-customer
//      reference (debts.metadata.extra.sadad_number), closing the gap where
//      STC/Mobily/Zain debts (no collection_accounts row) always resolved
//      beneficiary='unknown'.
//   2) auto-verify NEVER fires on amount or OCR confidence alone — it
//      requires beneficiary==='match' strictly (no more "unknown + high
//      confidence" escape hatch), and never for a wrong-portfolio
//      collection_accounts fallback.
//   4) any non-matched outcome (mismatch / unknown / text-only claim) is
//      recorded as verification_status='pending_verification' (not the
//      ambiguous 'pending'), with the single unified customer-facing reply.

let insertCalls: { table: string; payload: any }[] = []
let updateCalls: { table: string; payload: any }[] = []
let tableData: Record<string, any> = {}
let mockOcr: any = null
let lastReply = ''

function chain(result: any) {
  const obj: any = {
    eq: () => obj,
    order: () => obj,
    limit: () => obj,
    select: (..._args: any[]) => obj,
    maybeSingle: async () => result,
    single: async () => result,
    then: (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject),
  }
  return obj
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: (..._args: any[]) => chain(tableData[table] ?? { data: null, error: null }),
      insert: (payload: any) => {
        insertCalls.push({ table, payload })
        return chain({ data: tableData[`${table}_insert`] ?? null, error: null })
      },
      update: (payload: any) => {
        updateCalls.push({ table, payload })
        return chain({ data: null, error: null })
      },
    }),
  }),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendWhatsAppMessage: vi.fn().mockImplementation(async ({ message }: any) => {
    lastReply = message
    return { status: 'sent', message_id: 'wm1' }
  }),
}))

vi.mock('@/lib/revenue-attribution', () => ({
  recordAttribution: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/receipt-ocr', () => ({
  extractReceipt: vi.fn().mockImplementation(async () => mockOcr),
  extractReceiptFromPdf: vi.fn().mockImplementation(async () => mockOcr),
  extractReceiptFromText: vi.fn().mockImplementation(async () => mockOcr),
}))

import { processInboundReceipt } from '@/lib/payment-receipt'

function emptyOcr(overrides: Partial<any> = {}) {
  return {
    is_receipt: true, amount: null, currency: 'SAR', date: null,
    sender_name: null, bank: null, reference: null, iban_last4: null,
    beneficiary_name: null, invoice_number: null, confidence: 0,
    ...overrides,
  }
}

beforeEach(() => {
  insertCalls = []
  updateCalls = []
  lastReply = ''
  tableData = {
    payments_insert: { id: 'pay-1' },
    messages: { data: [], error: null, count: 0 },
  }
})

describe('1) SADAD/account-number reference matching (was always "unknown" before)', () => {
  it('an STC receipt whose invoice_number matches the customer sadad_number is auto-verified', async () => {
    tableData.debts = {
      data: {
        current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-stc', created_at: '2026-01-01',
        metadata: { extra: { sadad_number: '900111222' } },
      }, error: null,
    }
    tableData.collection_accounts = { data: [], error: null } // STC has none, by design
    mockOcr = emptyOcr({ amount: 500, invoice_number: '900111222', confidence: 90 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.status).toBe('completed')
    expect(paymentInsert?.payload.verification_status).toBe('verified')
  })

  it('the SAME receipt amount with a NON-matching invoice_number is never auto-verified', async () => {
    tableData.debts = {
      data: {
        current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-stc', created_at: '2026-01-01',
        metadata: { extra: { sadad_number: '900111222' } },
      }, error: null,
    }
    tableData.collection_accounts = { data: [], error: null }
    // A fabricated receipt: right amount, very high OCR confidence, but the
    // invoice number on it has nothing to do with this customer's SADAD number.
    mockOcr = emptyOcr({ amount: 500, invoice_number: '111999888', confidence: 97 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.status).toBe('pending')
    expect(paymentInsert?.payload.verification_status).toBe('pending_verification')
  })
})

describe('2) amount/confidence alone are never sufficient; no cross-portfolio account fallback', () => {
  it('amount matches and confidence is high, but there is NO reference at all to check → pending_verification (not auto-verified)', async () => {
    tableData.debts = {
      data: {
        current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'Some Co', portfolio_id: 'p-x', created_at: '2026-01-01',
        metadata: {},
      }, error: null,
    }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 500, confidence: 99 }) // no invoice_number, no reference at all

    const d = await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.verification_status).toBe('pending_verification')
    expect(lastReply).toBe('وصلنا الإيصال، وبنراجع مطابقته على الحساب ونتأكد من البيانات.')
  })

  it('a collection_accounts row belonging to a DIFFERENT portfolio is never used as a fallback match', async () => {
    tableData.debts = {
      data: {
        current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-stc', created_at: '2026-01-01',
        metadata: {},
      }, error: null,
    }
    // Only an account for an UNRELATED portfolio exists (has a portfolio_id
    // that does not match our debt's portfolio, and is not a null-portfolio
    // company default either).
    tableData.collection_accounts = {
      data: [{ method_type: 'bank_transfer', iban: 'SA000000000000000000UNRELATED', account_name: 'Other Co', portfolio_id: 'p-other' }],
      error: null,
    }
    mockOcr = emptyOcr({ amount: 500, iban_last4: '0000', confidence: 90 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.verification_status).toBe('pending_verification')
  })

  it('a text-only claim (no attachment) is NEVER auto-verified even with a perfectly matching reference', async () => {
    tableData.debts = {
      data: {
        current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: 'REF-1',
        account_number: 'ACC-1', creditor_name: 'Some Co', portfolio_id: 'p-x', created_at: '2026-01-01',
        metadata: {},
      }, error: null,
    }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 500, reference: 'REF-1', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'text', data: 'حولت لكم REF-1' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.status).toBe('pending')
    expect(paymentInsert?.payload.verification_status).toBe('pending_verification')
  })
})

describe('4) insurance IBAN matching still works correctly', () => {
  it('a matching IBAN tail auto-verifies', async () => {
    tableData.debts = {
      data: {
        current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'Tawuniya', portfolio_id: 'p-ins', created_at: '2026-01-01',
        metadata: {},
      }, error: null,
    }
    tableData.collection_accounts = {
      data: [{ method_type: 'bank_transfer', iban: 'SA0011223344556677889900', account_name: 'Tawuniya Insurance', portfolio_id: 'p-ins' }],
      error: null,
    }
    mockOcr = emptyOcr({ amount: 500, iban_last4: '9900', confidence: 90 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.status).toBe('completed')
    expect(paymentInsert?.payload.verification_status).toBe('verified')
  })

  it('a mismatched IBAN tail is never auto-verified', async () => {
    tableData.debts = {
      data: {
        current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'Tawuniya', portfolio_id: 'p-ins', created_at: '2026-01-01',
        metadata: {},
      }, error: null,
    }
    tableData.collection_accounts = {
      data: [{ method_type: 'bank_transfer', iban: 'SA0011223344556677889900', account_name: 'Tawuniya Insurance', portfolio_id: 'p-ins' }],
      error: null,
    }
    mockOcr = emptyOcr({ amount: 500, iban_last4: '1234', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.verification_status).toBe('pending_verification')
  })
})
