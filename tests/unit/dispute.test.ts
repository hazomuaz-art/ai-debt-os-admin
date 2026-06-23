import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the dispute-timeline fix: a genuinely new dispute now also creates
// a timeline_events entry (so the customer page reflects it), and the
// existing dedup path (open dispute already exists) still skips everything,
// including the new timeline insert.

const inserts: Record<string, any[]> = {}
let openDisputeExists = false

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      insert: vi.fn().mockImplementation((row: any) => {
        inserts[table] = inserts[table] ?? []
        inserts[table].push(row)
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'disp-1' }, error: null }),
          }),
        }
      }),
      select: vi.fn().mockImplementation(() => {
        const chain: any = {}
        chain.eq = vi.fn().mockReturnValue(chain)
        chain.in = vi.fn().mockReturnValue(chain)
        chain.order = vi.fn().mockReturnValue(chain)
        chain.limit = vi.fn().mockReturnValue(chain)
        chain.maybeSingle = vi.fn().mockImplementation(async () =>
          table === 'disputes' && openDisputeExists
            ? { data: { id: 'existing-disp' }, error: null }
            : { data: table === 'debts' ? { current_balance: 1000 } : null, error: null })
        return chain
      }),
    })),
  })),
}))

vi.mock('@/lib/revenue-attribution', () => ({
  recordAttribution: vi.fn().mockResolvedValue(undefined),
}))

import { recordDispute } from '@/lib/dispute'

beforeEach(() => {
  Object.keys(inserts).forEach(k => delete inserts[k])
  openDisputeExists = false
})

describe('recordDispute — timeline event', () => {
  it('a genuinely new dispute creates a timeline_events entry', async () => {
    await recordDispute({
      company_id: 'c1', customer_id: 'u1', customer_name: 'محمد العتيبي',
      debt_id: 'd1', customer_message: 'هذا الدين مو لي', agent_reason: 'customer denies debt',
    })

    expect(inserts['disputes']).toHaveLength(1)
    expect(inserts['timeline_events']).toHaveLength(1)
    expect(inserts['timeline_events'][0]).toMatchObject({ event_type: 'escalation', debt_id: 'd1' })
    expect(inserts['approvals']).toHaveLength(1)
  })

  it('dedup: an existing open dispute skips disputes/approvals/timeline entirely', async () => {
    openDisputeExists = true
    await recordDispute({
      company_id: 'c1', customer_id: 'u1', debt_id: 'd1', customer_message: 'تابع لاعتراضي',
    })

    expect(inserts['disputes']).toBeUndefined()
    expect(inserts['timeline_events']).toBeUndefined()
    expect(inserts['approvals']).toBeUndefined()
  })
})
