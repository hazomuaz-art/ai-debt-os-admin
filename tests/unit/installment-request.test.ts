import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the installment-request E2E fix: a customer-initiated installment
// request raised by the agent (action=record_installment_request) actually
// gets persisted — admin approval + system alert + customer timeline — and
// never auto-approves anything or touches debts.status.

const inserts: Record<string, any[]> = {}
let pendingApprovalExists = false

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      insert: vi.fn().mockImplementation((row: any) => {
        inserts[table] = inserts[table] ?? []
        inserts[table].push(row)
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'id-1' }, error: null }),
          }),
        }
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockImplementation(async () =>
            pendingApprovalExists ? { data: { id: 'existing-1' }, error: null } : { data: null, error: null }),
        }),
      }),
    })),
  })),
}))

import { recordInstallmentRequest } from '@/lib/installment-request'

beforeEach(() => {
  Object.keys(inserts).forEach(k => delete inserts[k])
  pendingApprovalExists = false
})

describe('recordInstallmentRequest', () => {
  it('creates an approval, a system alert, and a timeline event — no debt status change', async () => {
    await recordInstallmentRequest({
      company_id: 'c1', customer_id: 'u1', customer_name: 'محمد العتيبي',
      debt_id: 'd1', customer_message: 'أبغى أسوي تقسيط للدين',
      agent_message: 'أقدر أرفع طلبك للمراجعة',
    })

    expect(inserts['approvals']).toHaveLength(1)
    expect(inserts['approvals'][0]).toMatchObject({
      approval_type: 'custom', entity_type: 'debt', entity_id: 'd1', status: 'pending',
    })
    expect(inserts['approvals'][0].requested_data).toMatchObject({ kind: 'installment_request' })

    expect(inserts['system_alerts']).toHaveLength(1)
    expect(inserts['system_alerts'][0]).toMatchObject({ alert_type: 'installment_request', is_resolved: false })

    expect(inserts['timeline_events']).toHaveLength(1)
    expect(inserts['timeline_events'][0]).toMatchObject({ event_type: 'escalation', debt_id: 'd1' })

    expect(inserts['debts']).toBeUndefined()
  })

  it('never auto-approves — status is always pending', async () => {
    await recordInstallmentRequest({
      company_id: 'c1', customer_id: 'u1', debt_id: 'd1', customer_message: 'أبغى تقسيط',
    })
    expect(inserts['approvals'][0].status).toBe('pending')
  })

  it('dedup: skips creating a second approval/alert/timeline when one is already pending for this debt', async () => {
    pendingApprovalExists = true
    await recordInstallmentRequest({
      company_id: 'c1', customer_id: 'u1', debt_id: 'd1', customer_message: 'تابع لطلبي بخصوص التقسيط',
    })

    expect(inserts['approvals']).toBeUndefined()
    expect(inserts['system_alerts']).toBeUndefined()
    expect(inserts['timeline_events']).toBeUndefined()
  })
})
