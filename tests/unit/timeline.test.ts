import { describe, it, expect, vi, beforeEach } from 'vitest'

let insertedRow: any = null
let returnedError: { message: string } | null = null

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockImplementation(() => ({
    from: vi.fn().mockImplementation(() => ({
      insert: vi.fn().mockImplementation((row: any) => {
        insertedRow = row
        return Promise.resolve({ data: null, error: returnedError })
      }),
    })),
  })),
}))

import { insertTimelineEvent } from '@/lib/timeline'

beforeEach(() => { insertedRow = null; returnedError = null })

// The permanent structural fix for the full-system audit (2026-06-29): the
// real columns are summary/detail (not title/description, what the old
// dead createTimelineEvent() used), and event_type/actor_type/channel are
// typed against the real CHECK constraints so an invalid literal is now a
// compile error.
describe('insertTimelineEvent', () => {
  it('writes to the real columns (summary/detail), not the old broken title/description shape', async () => {
    await insertTimelineEvent({
      company_id: 'c', debt_id: 'd', event_type: 'status_change', channel: 'system',
      actor_type: 'system', summary: 'test summary', detail: 'test detail',
    })
    expect(insertedRow.summary).toBe('test summary')
    expect(insertedRow.detail).toBe('test detail')
    expect(insertedRow.title).toBeUndefined()
    expect(insertedRow.description).toBeUndefined()
  })

  it('logs (never throws) when the insert fails for any reason', async () => {
    returnedError = { message: 'simulated failure' }
    await expect(insertTimelineEvent({
      company_id: 'c', event_type: 'ai_reply', channel: 'whatsapp', actor_type: 'ai', summary: 'x',
    })).resolves.toBeUndefined()
  })
})
