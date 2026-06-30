import { describe, it, expect, vi, beforeEach } from 'vitest'

let insertedRow: any = null
let returnedError: { message: string } | null = null
let returnedData: any = { id: 'row-1' }

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      insert: vi.fn().mockImplementation((row: any) => {
        insertedRow = row
        return {
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: returnedData, error: returnedError }),
        }
      }),
    })),
  })),
}))

import { insertSystemAlert } from '@/lib/system-alerts'
import { insertApproval } from '@/lib/approvals'

beforeEach(() => { insertedRow = null; returnedError = null; returnedData = { id: 'row-1' } })

describe('insertSystemAlert — typed against the real severity CHECK constraint', () => {
  it('inserts with the real columns and never throws', async () => {
    await expect(insertSystemAlert({
      company_id: 'c', severity: 'critical', alert_type: 'test_alert', title: 't', message: 'm',
    })).resolves.toBeUndefined()
    expect(insertedRow.severity).toBe('critical')
    expect(insertedRow.is_read).toBe(false)
    expect(insertedRow.is_resolved).toBe(false)
  })
})

describe('insertApproval — typed against the real approval_type CHECK constraint', () => {
  it('inserts and returns the new row id', async () => {
    const result = await insertApproval({
      company_id: 'c', approval_type: 'custom', entity_type: 'debt', entity_id: 'd1',
      title: 't', description: 'd', priority: 'high',
    })
    expect(result).toEqual({ id: 'row-1' })
    expect(insertedRow.approval_type).toBe('custom')
    expect(insertedRow.status).toBe('pending')
  })

  it('returns null (never throws) when the insert fails', async () => {
    returnedError = { message: 'simulated failure' }
    returnedData = null
    const result = await insertApproval({
      company_id: 'c', approval_type: 'custom', entity_type: 'debt', entity_id: 'd1',
      title: 't', description: 'd', priority: 'medium',
    })
    expect(result).toBeNull()
  })
})
