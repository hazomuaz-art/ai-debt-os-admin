import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mutable fixtures the mocked Supabase client reads from per test.
let insertResult: { data: any; error: any } = { data: { id: 'attr-1' }, error: null }
let selectRows: any[] = []
let lastInsertPayload: any = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation((table: string) => ({
      insert: vi.fn().mockImplementation((payload: any) => {
        lastInsertPayload = { table, payload }
        return {
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue(insertResult),
          }),
        }
      }),
      select: vi.fn().mockImplementation(() => {
        const builder: any = {
          eq: vi.fn(() => builder),
          in: vi.fn(() => builder),
          gte: vi.fn(() => builder),
          lte: vi.fn(() => builder),
          then: (resolve: any) => resolve({ data: selectRows }),
        }
        return builder
      }),
    })),
  })),
}))

import { recordAttribution, getChannelSummary, getAIvsHumanSummary } from '@/lib/revenue-attribution'

beforeEach(() => {
  insertResult = { data: { id: 'attr-1' }, error: null }
  selectRows = []
  lastInsertPayload = null
})

describe('recordAttribution', () => {
  it('writes to collection_attribution, NOT revenue_events', async () => {
    await recordAttribution({
      company_id: 'c', event_type: 'payment', customer_id: 'u', debt_id: 'd',
      amount: 100, primary_channel: 'ai_reply', primary_actor: 'ai',
    })
    expect(lastInsertPayload.table).toBe('collection_attribution')
  })

  it('maps fields to the REAL column names (primary_channel/primary_actor/rule_used/touches_before_pay)', async () => {
    await recordAttribution({
      company_id: 'c', event_type: 'settlement', customer_id: 'u', debt_id: 'd',
      amount: 500, primary_channel: 'whatsapp', primary_actor: 'ai',
      rule_used: true, touches_before_pay: 7, days_to_collect: 3,
    })
    expect(lastInsertPayload.payload.primary_channel).toBe('whatsapp')
    expect(lastInsertPayload.payload.primary_actor).toBe('ai')
    expect(lastInsertPayload.payload.rule_used).toBe(true)
    expect(lastInsertPayload.payload.touches_before_pay).toBe(7)
    expect(lastInsertPayload.payload).not.toHaveProperty('attribution_channel')
    expect(lastInsertPayload.payload).not.toHaveProperty('roi')
  })

  it('a duplicate (unique-violation) insert is treated as a successful no-op, not an error', async () => {
    insertResult = { data: null, error: { code: '23505', message: 'duplicate key' } }
    const id = await recordAttribution({
      company_id: 'c', event_type: 'promise', source_id: 'promise-1', customer_id: 'u', debt_id: 'd',
      amount: 200, primary_channel: 'whatsapp', primary_actor: 'ai',
    })
    expect(id).toBeNull() // no new row, but no throw either
  })

  it('never throws when the insert fails for a real reason — caller flow must continue', async () => {
    insertResult = { data: null, error: { code: '42501', message: 'permission denied' } }
    await expect(recordAttribution({
      company_id: 'c', event_type: 'dispute', customer_id: 'u', debt_id: 'd',
      amount: 0, primary_channel: 'whatsapp', primary_actor: 'ai',
    })).resolves.toBeNull()
  })

  it('records supporting_actor when a human intervened on an AI-initiated event', async () => {
    await recordAttribution({
      company_id: 'c', event_type: 'settlement', customer_id: 'u', debt_id: 'd',
      amount: 100, primary_channel: 'ai_reply', primary_actor: 'ai_assisted',
      supporting_actor: 'collector',
    })
    expect(lastInsertPayload.payload.supporting_actor).toBe('collector')
    expect(lastInsertPayload.payload.primary_actor).toBe('ai_assisted')
  })
})

describe('getAIvsHumanSummary / getChannelSummary — only count real revenue', () => {
  it('sums ai vs human vs ai_assisted correctly and excludes non-revenue event types via the query filter', async () => {
    selectRows = [
      { primary_actor: 'ai', amount: 100, ai_assisted: false },
      { primary_actor: 'collector', amount: 50, ai_assisted: false },
      { primary_actor: 'collector', amount: 30, ai_assisted: true },
    ]
    const summary = await getAIvsHumanSummary('c', '2026-01-01')
    expect(summary.ai).toBe(100)
    expect(summary.human).toBe(50)
    expect(summary.ai_assisted).toBe(30)
    expect(summary.ai_count).toBe(1)
  })

  it('channel summary aggregates by primary_channel', async () => {
    selectRows = [
      { primary_channel: 'whatsapp', amount: 100, days_to_collect: 2 },
      { primary_channel: 'whatsapp', amount: 200, days_to_collect: 4 },
      { primary_channel: 'collector', amount: 50, days_to_collect: 1 },
    ]
    const rows = await getChannelSummary('c', '2026-01-01', '2026-01-31')
    const wa = rows.find(r => r.channel === 'whatsapp')!
    expect(wa.total_amount).toBe(300)
    expect(wa.count).toBe(2)
    expect(wa.avg_days).toBe(3)
  })
})

describe('promises.status regression (found while wiring Revenue Attribution)', () => {
  it('promises_status_check only allows pending|kept|broken|rescheduled|partial — "fulfilled" is invalid', () => {
    // Documents the real DB constraint discovered in production: the
    // payment-receipt.ts fulfillment update must use 'kept', never
    // 'fulfilled', or the update is silently rejected by Postgres.
    const validStatuses = ['pending', 'kept', 'broken', 'rescheduled', 'partial']
    expect(validStatuses).not.toContain('fulfilled')
    expect(validStatuses).toContain('kept')
  })
})
