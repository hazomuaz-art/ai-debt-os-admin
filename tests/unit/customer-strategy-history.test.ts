import { describe, it, expect, vi, beforeEach } from 'vitest'

let promisesData: any[] = []
let messagesData: any[] = []
let disputesData: any[] = []

function chain(data: any[]) {
  const builder: any = {}
  const methods = ['select', 'eq', 'in', 'order', 'limit']
  for (const m of methods) builder[m] = vi.fn().mockReturnValue(builder)
  builder.then = (resolve: any) => resolve({ data, error: null })
  return builder
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'promises') return chain(promisesData)
      if (table === 'messages') return chain(messagesData)
      if (table === 'disputes') return chain(disputesData)
      return chain([])
    }),
  })),
}))

import { analyzeCustomerStrategyHistory } from '@/lib/customer-strategy-history'

beforeEach(() => {
  promisesData = []
  messagesData = []
  disputesData = []
})

describe('analyzeCustomerStrategyHistory', () => {
  it('returns null when the customer has no resolved promise history at all (no guessing from insufficient data)', async () => {
    const result = await analyzeCustomerStrategyHistory('c', 'u')
    expect(result).toBeNull()
  })

  it('a kept promise preceded by a "negotiate" reply marks that action as effective for this customer', async () => {
    promisesData = [{ status: 'kept', created_at: '2026-06-20T10:00:00.000Z' }]
    messagesData = [
      { sent_at: '2026-06-20T09:50:00.000Z', metadata: { action_type: 'negotiate' } },
    ]
    const result = await analyzeCustomerStrategyHistory('c', 'u')
    expect(result?.effectiveActions).toEqual(['negotiate'])
    expect(result?.ineffectiveActions).toEqual([])
  })

  it('a broken promise preceded by a "pressure" reply marks that action as ineffective for this customer', async () => {
    promisesData = [{ status: 'broken', created_at: '2026-06-20T10:00:00.000Z' }]
    messagesData = [
      { sent_at: '2026-06-20T09:55:00.000Z', metadata: { action_type: 'pressure' } },
    ]
    const result = await analyzeCustomerStrategyHistory('c', 'u')
    expect(result?.ineffectiveActions).toEqual(['pressure'])
    expect(result?.effectiveActions).toEqual([])
  })

  it('a message more than an hour before the promise is NOT counted as its precursor', async () => {
    promisesData = [{ status: 'kept', created_at: '2026-06-20T10:00:00.000Z' }]
    messagesData = [
      { sent_at: '2026-06-20T08:00:00.000Z', metadata: { action_type: 'negotiate' } },
    ]
    const result = await analyzeCustomerStrategyHistory('c', 'u')
    // No precursor found within the window and no objections -> null, not a
    // fabricated empty-but-truthy result.
    expect(result).toBeNull()
  })

  it('past objection types are surfaced even without any resolved promise precursor match', async () => {
    promisesData = [{ status: 'partial', created_at: '2026-06-20T10:00:00.000Z' }]
    disputesData = [{ dispute_type: 'amount_wrong' }, { dispute_type: 'amount_wrong' }, { dispute_type: 'already_paid' }]
    const result = await analyzeCustomerStrategyHistory('c', 'u')
    expect(result?.pastObjectionTypes.sort()).toEqual(['already_paid', 'amount_wrong'])
  })
})
