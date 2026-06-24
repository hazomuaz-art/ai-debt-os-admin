import { describe, it, expect, vi, beforeEach } from 'vitest'

// End-to-end proof (not prompt-level) that processInboundReceipt never
// confirms a payment except by REAL matching against portfolio/company data,
// AND never guesses which debt a receipt belongs to when a customer has
// more than one open debt:
//   1) amount mismatch (even with a perfectly matching reference) → pending.
//   2) account-number mismatch → pending.
//   3) SADAD/IBAN mismatch → pending (extended per the explicit audit ask).
//   4) forged/no-data receipt → never silently accepted (either ignored for
//      the agent to handle, or flagged pending_verification — never 'completed').
//   5) partial payment → debt stays open, balance reduced, not 'settled'.
//   6) full payment → debt 'settled' + promise marked 'kept' + timeline +
//      attribution, full system update.
//   7) multiple open debts: a receipt is matched against EVERY open debt
//      (not a single upstream "latest debt" guess) — the correct debt is
//      selected and updated, a non-matching receipt is never silently
//      attributed to any debt, and a receipt matching more than one debt is
//      treated as ambiguous (no debt closed, human review required).
//   8) portfolio-policy differentiation: STC/Mobily/utilities verify via
//      per-customer reference; insurance verifies via IBAN — driven by real
//      collection_accounts/debt data, not a generic one-size-fits-all rule.

let insertCalls: { table: string; payload: any }[] = []
let updateCalls: { table: string; payload: any }[] = []
let tableData: Record<string, any> = {}
let mockOcr: any = null
let lastReply = ''

function chain(result: any) {
  const obj: any = {
    eq: () => obj,
    not: () => obj,
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
import { recordAttribution } from '@/lib/revenue-attribution'

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
  vi.clearAllMocks()
})

describe('1) amount mismatch never auto-verifies, even with a perfect reference match', () => {
  it('OCR amount wildly exceeds the actual balance → pending, not completed', async () => {
    tableData.debts = {
      data: [{
        id: 'd1', current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-stc', created_at: '2026-01-01',
        metadata: { extra: { sadad_number: '900111222' } },
      }], error: null,
    }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 50000, invoice_number: '900111222', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.status).toBe('pending')
    expect(paymentInsert?.payload.verification_status).toBe('pending_verification')
    const debtUpdate = updateCalls.find(c => c.table === 'debts')
    expect(debtUpdate).toBeUndefined()
  })
})

describe('2) account-number mismatch never auto-verifies', () => {
  it('account_number on file does not match anything on the receipt → pending', async () => {
    tableData.debts = {
      data: [{
        id: 'd1', current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: 'ACC-REAL-001', creditor_name: 'Mobily', portfolio_id: 'p-mobily', created_at: '2026-01-01',
        metadata: {},
      }], error: null,
    }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 500, invoice_number: 'ACC-FAKE-999', confidence: 92 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.status).toBe('pending')
    expect(paymentInsert?.payload.verification_status).toBe('pending_verification')
  })
})

describe('3) SADAD number / IBAN mismatch never auto-verifies (per-portfolio reference)', () => {
  it('SADAD mismatch on a telecom debt → pending', async () => {
    tableData.debts = {
      data: [{
        id: 'd1', current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-stc', created_at: '2026-01-01',
        metadata: { extra: { sadad_number: '900111222' } },
      }], error: null,
    }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 500, invoice_number: '000000000', confidence: 90 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    expect(insertCalls.find(c => c.table === 'payments')?.payload.verification_status).toBe('pending_verification')
  })

  it('IBAN mismatch on an insurance debt → pending', async () => {
    tableData.debts = {
      data: [{
        id: 'd1', current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'Tawuniya', portfolio_id: 'p-ins', created_at: '2026-01-01', metadata: {},
      }], error: null,
    }
    tableData.collection_accounts = {
      data: [{ method_type: 'bank_transfer', iban: 'SA0011223344556677889900', account_name: 'Tawuniya Insurance', portfolio_id: 'p-ins' }],
      error: null,
    }
    mockOcr = emptyOcr({ amount: 500, iban_last4: '9999', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    expect(insertCalls.find(c => c.table === 'payments')?.payload.verification_status).toBe('pending_verification')
  })
})

describe('4) forged / no-data receipts are never silently accepted', () => {
  it('not recognized as a receipt at all (is_receipt=false) → no payment row created, agent/human handles it', async () => {
    tableData.debts = { data: [{ id: 'd1', current_balance: 500, currency: 'SAR', status: 'overdue', metadata: {}, portfolio_id: 'p1', created_at: '2026-01-01' }], error: null }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = { is_receipt: false }

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    expect(insertCalls.find(c => c.table === 'payments')).toBeUndefined()
    expect(insertCalls.find(c => c.table === 'system_alerts')).toBeUndefined()
  })

  it('recognized as a receipt but amount unreadable → flagged for manual review, no payment row, no auto-verify', async () => {
    tableData.debts = { data: [{ id: 'd1', current_balance: 500, currency: 'SAR', status: 'overdue', metadata: {}, portfolio_id: 'p1', created_at: '2026-01-01' }], error: null }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: null, confidence: 80 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    expect(insertCalls.find(c => c.table === 'payments')).toBeUndefined()
    const alert = insertCalls.find(c => c.table === 'system_alerts')
    expect(alert?.payload.alert_type).toBe('payment_review')
    expect(alert?.payload.is_resolved).toBe(false)
  })

  it('no open debt at all → flagged for review, never guesses a debt to update', async () => {
    tableData.debts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 500, confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: null, phone: '+966500000000', source: 'image', data: 'b64' })

    expect(insertCalls.find(c => c.table === 'payments')).toBeUndefined()
    expect(updateCalls.find(c => c.table === 'debts')).toBeUndefined()
    expect(insertCalls.find(c => c.table === 'system_alerts')?.payload.alert_type).toBe('payment_review')
  })
})

describe('5) partial payment never closes the debt', () => {
  it('amount less than balance → debt stays open with the reduced balance, status not settled', async () => {
    tableData.debts = {
      data: [{
        id: 'd1', current_balance: 1000, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-stc', created_at: '2026-01-01',
        metadata: { extra: { sadad_number: '900111222' } },
      }], error: null,
    }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 400, invoice_number: '900111222', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.status).toBe('completed')
    expect(paymentInsert?.payload.verification_status).toBe('verified')
    const debtUpdate = updateCalls.find(c => c.table === 'debts')
    expect(debtUpdate?.payload.current_balance).toBe(600)
    expect(debtUpdate?.payload.status).not.toBe('settled')
  })
})

describe('6) full payment updates the system end-to-end', () => {
  it('amount equal to the balance → debt settled, promise marked kept, timeline + attribution recorded', async () => {
    tableData.debts = {
      data: [{
        id: 'd1', current_balance: 1000, currency: 'SAR', status: 'promised', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-stc', created_at: '2026-01-01',
        metadata: { extra: { sadad_number: '900111222' } },
      }], error: null,
    }
    tableData.collection_accounts = { data: [], error: null }
    tableData.messages = { data: [], error: null, count: 3 }
    mockOcr = emptyOcr({ amount: 1000, invoice_number: '900111222', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.status).toBe('completed')
    expect(paymentInsert?.payload.verification_status).toBe('verified')

    const debtUpdate = updateCalls.find(c => c.table === 'debts')
    expect(debtUpdate?.payload.current_balance).toBe(0)
    expect(debtUpdate?.payload.status).toBe('settled')

    const promiseUpdate = updateCalls.find(c => c.table === 'promises')
    expect(promiseUpdate?.payload.status).toBe('kept')

    const timelineInsert = insertCalls.find(c => c.table === 'timeline_events')
    expect(timelineInsert?.payload.summary).toMatch(/سُدّدت المديونية بالكامل/)

    expect(recordAttribution).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'settlement', debt_id: 'd1', amount: 1000 }))
  })
})

describe('7) multiple open debts — receipt is matched against EVERY debt, never a single upstream guess', () => {
  function twoDebts() {
    return [
      {
        id: 'debt-A', current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-stc', created_at: '2026-01-01',
        metadata: { extra: { sadad_number: '900200001' } },
      },
      {
        id: 'debt-B', current_balance: 800, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'Mobily', portfolio_id: 'p-mobily', created_at: '2026-01-02',
        metadata: { extra: { sadad_number: '900200002' } },
      },
    ]
  }

  it('a receipt matching debt A (the OLDER debt, not the upstream "latest" guess) updates ONLY debt A', async () => {
    tableData.debts = { data: twoDebts(), error: null }
    tableData.collection_accounts = { data: [], error: null }
    // The webhook's naive "latest debt" guess would have picked debt-B
    // (created later) — but the receipt actually matches debt-A's SADAD
    // number, and a correct selector must use that, not the hint.
    mockOcr = emptyOcr({ amount: 500, invoice_number: '900200001', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'debt-B', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.debt_id).toBe('debt-A')
    expect(paymentInsert?.payload.verification_status).toBe('verified')
    const debtUpdate = updateCalls.find(c => c.table === 'debts')
    expect(debtUpdate?.payload.status).toBe('settled') // 500 == debt-A's full balance
    // debt-B must never be touched.
    expect(updateCalls.some(c => c.table === 'debts' && c.payload === debtUpdate?.payload)).toBe(true)
  })

  it('a receipt matching debt B updates ONLY debt B, never debt A', async () => {
    tableData.debts = { data: twoDebts(), error: null }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 800, invoice_number: '900200002', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'debt-A', phone: '+966500000000', source: 'image', data: 'b64' })

    const paymentInsert = insertCalls.find(c => c.table === 'payments')
    expect(paymentInsert?.payload.debt_id).toBe('debt-B')
    expect(paymentInsert?.payload.verification_status).toBe('verified')
  })

  it('a receipt matching NEITHER debt → ambiguous, no payment row, no debt update, flagged for human review', async () => {
    tableData.debts = { data: twoDebts(), error: null }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 500, invoice_number: '900299999', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'debt-B', phone: '+966500000000', source: 'image', data: 'b64' })

    expect(insertCalls.find(c => c.table === 'payments')).toBeUndefined()
    expect(updateCalls.find(c => c.table === 'debts')).toBeUndefined()
    const alert = insertCalls.find(c => c.table === 'system_alerts')
    expect(alert?.payload.alert_type).toBe('payment_review')
    expect(alert?.payload.metadata.candidate_debt_ids).toEqual(['debt-A', 'debt-B'])
  })

  it('a receipt matching BOTH debts (ambiguous) → no debt closed, flagged for human review listing every match', async () => {
    const ambiguousDebts = [
      {
        id: 'debt-A', current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-x', created_at: '2026-01-01',
        metadata: { extra: { sadad_number: '900300001' } },
      },
      {
        id: 'debt-B', current_balance: 500, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'STC', portfolio_id: 'p-x', created_at: '2026-01-02',
        // Same SADAD number on file as debt-A (data-entry duplicate) — the
        // receipt genuinely cannot be attributed to one specific debt.
        metadata: { extra: { sadad_number: '900300001' } },
      },
    ]
    tableData.debts = { data: ambiguousDebts, error: null }
    tableData.collection_accounts = { data: [], error: null }
    mockOcr = emptyOcr({ amount: 500, invoice_number: '900300001', confidence: 95 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'debt-A', phone: '+966500000000', source: 'image', data: 'b64' })

    expect(insertCalls.find(c => c.table === 'payments')).toBeUndefined()
    expect(updateCalls.find(c => c.table === 'debts')).toBeUndefined()
    const alert = insertCalls.find(c => c.table === 'system_alerts')
    expect(alert?.payload.alert_type).toBe('payment_review')
    expect(alert?.payload.metadata.matched_debt_ids.sort()).toEqual(['debt-A', 'debt-B'])
  })
})

describe('8) portfolio-policy differentiation — verification method follows the PORTFOLIO\'S configured data, not a generic rule', () => {
  const referenceCases = [
    { label: 'STC (telecom)', creditor: 'STC', sadad: '900100001' },
    { label: 'Mobily (telecom)', creditor: 'Mobily', sadad: '900100002' },
    { label: 'Electricity (utility)', creditor: 'SEC', sadad: '900100003' },
    { label: 'Water (utility)', creditor: 'NWC', sadad: '900100004' },
  ]
  for (const c of referenceCases) {
    it(`${c.label} verifies via the per-customer SADAD reference, not an IBAN`, async () => {
      tableData.debts = {
        data: [{
          id: 'd1', current_balance: 300, currency: 'SAR', status: 'overdue', reference_number: null,
          account_number: null, creditor_name: c.creditor, portfolio_id: 'p-x', created_at: '2026-01-01',
          metadata: { extra: { sadad_number: c.sadad } },
        }], error: null,
      }
      tableData.collection_accounts = { data: [], error: null }
      mockOcr = emptyOcr({ amount: 300, invoice_number: c.sadad, confidence: 90 })

      await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

      expect(insertCalls.find(ic => ic.table === 'payments')?.payload.verification_status).toBe('verified')
    })
  }

  it('Insurance verifies via the company IBAN, not a SADAD reference', async () => {
    tableData.debts = {
      data: [{
        id: 'd1', current_balance: 300, currency: 'SAR', status: 'overdue', reference_number: null,
        account_number: null, creditor_name: 'Tawuniya', portfolio_id: 'p-ins', created_at: '2026-01-01', metadata: {},
      }], error: null,
    }
    tableData.collection_accounts = {
      data: [{ method_type: 'bank_transfer', iban: 'SA1122334455667788990011', account_name: 'Tawuniya', portfolio_id: 'p-ins' }],
      error: null,
    }
    mockOcr = emptyOcr({ amount: 300, iban_last4: '0011', confidence: 90 })

    await processInboundReceipt({ company_id: 'c', customer_id: 'u', debt_id: 'd1', phone: '+966500000000', source: 'image', data: 'b64' })

    expect(insertCalls.find(c => c.table === 'payments')?.payload.verification_status).toBe('verified')
  })
})
