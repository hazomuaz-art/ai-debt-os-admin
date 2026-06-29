import { describe, it, expect, vi, beforeEach } from 'vitest'

// Full-system audit finding: 'dispute' and 'payment_plan' were never valid
// approvals.approval_type values (the real CHECK constraint only allows
// large_settlement/discount/legal_escalation/stop_followup/write_off/
// ai_learning/campaign_launch/custom) — every dispute and every installment
// request approval has been failing to save silently since each shipped.
// Both now correctly use 'custom', distinguished by
// requested_data.request_subtype instead — this locks that contract in so
// it can never regress back to a value the database will reject.
let insertedRows: Record<string, any[]> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: { id: 'row-1' }, error: null }),
      insert: vi.fn().mockImplementation((row: any) => {
        insertedRows[table] = insertedRows[table] ?? []
        insertedRows[table].push(row)
        return { select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { id: 'row-1' }, error: null }) }
      }),
      update: vi.fn().mockReturnThis(),
    })),
  })),
}))

import { recordDispute } from '@/lib/dispute'
import { recordInstallmentRequest } from '@/lib/installment-request'

const VALID_APPROVAL_TYPES = ['large_settlement', 'discount', 'legal_escalation', 'stop_followup', 'write_off', 'ai_learning', 'campaign_launch', 'custom']

beforeEach(() => { insertedRows = {} })

describe('approvals.approval_type — must always be a value the real CHECK constraint accepts', () => {
  it('recordDispute inserts a valid approval_type and a request_subtype marker', async () => {
    await recordDispute({ company_id: 'c', customer_id: 'u', debt_id: 'd', customer_message: 'هذا رقم غلط مو رقمي' })
    const approval = insertedRows['approvals']?.[0]
    expect(approval).toBeDefined()
    expect(VALID_APPROVAL_TYPES).toContain(approval.approval_type)
    expect(approval.requested_data.request_subtype).toBe('dispute')
  })

  it('recordInstallmentRequest inserts a valid approval_type and a request_subtype marker', async () => {
    await recordInstallmentRequest({ company_id: 'c', customer_id: 'u', debt_id: 'd', customer_message: 'ابغى اقسط' })
    const approval = insertedRows['approvals']?.[0]
    expect(approval).toBeDefined()
    expect(VALID_APPROVAL_TYPES).toContain(approval.approval_type)
    expect(approval.requested_data.request_subtype).toBe('installment')
  })

  it('the two subtypes never collide on approval_type alone — distinguishable only by request_subtype', async () => {
    await recordDispute({ company_id: 'c', customer_id: 'u', debt_id: 'd1', customer_message: 'مو دين علي' })
    await recordInstallmentRequest({ company_id: 'c', customer_id: 'u', debt_id: 'd2', customer_message: 'ابغى اقسط' })
    const [disputeApproval, installmentApproval] = insertedRows['approvals']
    expect(disputeApproval.approval_type).toBe(installmentApproval.approval_type)
    expect(disputeApproval.requested_data.request_subtype).not.toBe(installmentApproval.requested_data.request_subtype)
  })
})
