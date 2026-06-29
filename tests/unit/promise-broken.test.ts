import { describe, it, expect, vi, beforeEach } from 'vitest'

// Real production gap: nothing in the system ever transitioned a promise
// out of 'pending' except an actual payment arriving. A customer who
// explicitly retracted their own promise mid-conversation was left showing
// as a standing, open promise forever on the promises page.
let existingPromise: any = { id: 'p1', company_id: 'c1', customer_id: 'u1' }
let updateCalls: any[] = []
let timelineInserts: any[] = []

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'promises') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: existingPromise, error: null }),
          update: vi.fn().mockImplementation((payload: any) => {
            updateCalls.push(payload)
            return { eq: vi.fn().mockResolvedValue({ data: null, error: null }) }
          }),
        }
      }
      if (table === 'timeline_events') {
        return { insert: vi.fn().mockImplementation((row: any) => { timelineInserts.push(row); return Promise.resolve({ data: null, error: null }) }) }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }
    }),
  })),
}))

import { markOpenPromiseBroken } from '@/lib/promise'

beforeEach(() => {
  existingPromise = { id: 'p1', company_id: 'c1', customer_id: 'u1' }
  updateCalls = []
  timelineInserts = []
})

describe('markOpenPromiseBroken', () => {
  it('marks the open pending promise as broken and logs a valid timeline event', async () => {
    await markOpenPromiseBroken({ debt_id: 'd1', customer_message: 'لا انا ما اتفقت معك علي شي وماراح اسدد' })
    expect(updateCalls).toEqual([{ status: 'broken' }])
    expect(timelineInserts.length).toBe(1)
    // 'promise_broken' is NOT a valid timeline_events.event_type — must use
    // one of the actual CHECK-constraint-allowed values (status_change).
    expect(timelineInserts[0].event_type).toBe('status_change')
  })

  it('does nothing (no error) when there is no open promise on this debt', async () => {
    existingPromise = null
    await expect(markOpenPromiseBroken({ debt_id: 'd1', customer_message: 'x' })).resolves.toBeUndefined()
    expect(updateCalls.length).toBe(0)
  })
})
