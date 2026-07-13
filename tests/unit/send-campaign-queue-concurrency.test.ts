import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Direct regression proof for the real production double-send incident
// (2026-07-06): the campaign queue used to do a plain SELECT of pending rows
// then send them, with no claim — two overlapping invocations of this same
// route (confirmed live: a manual trigger overlapping the scheduled cron)
// both picked up the SAME pending row and both actually sent it, producing
// two distinct real WhatsApp messages seconds apart. This test calls the
// ACTUAL route handler TWICE concurrently (Promise.all, not sequentially)
// against a single shared in-memory row that faithfully models Postgres's
// row-level UPDATE...WHERE atomicity, and asserts the real send function
// fires exactly once no matter how the two invocations interleave.

type QueueRow = {
  id: string; company_id: string; campaign_id: string; recipient_id: string
  customer_id: string; debt_id: string; message_text: string | null
  attempts: number; max_attempts: number; status: string; scheduled_at: string
}

let queueRow: QueueRow
let sentCalls: number

const mockSendWhatsAppMessage = vi.fn().mockImplementation(async () => {
  sentCalls++
  return { status: 'sent', message_id: `wam-${sentCalls}` }
})
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: (...args: any[]) => mockSendWhatsAppMessage(...args) }))
vi.mock('@/lib/campaign-message', () => ({ generateCampaignMessage: vi.fn().mockResolvedValue('رسالة تجريبية') }))
// Isolate this test to the claim mechanism alone — the gate is exercised by
// its own dedicated test suite (send-gate.test.ts) and by the sequential
// gate-integration test below in this same file.
vi.mock('@/lib/send-gate', () => ({
  isWhatsAppSessionHealthy: vi.fn().mockResolvedValue(true),
  canSendUnpromptedMessage: vi.fn().mockResolvedValue({ allowed: true }),
  isDeliveryQualityHealthy: vi.fn().mockResolvedValue({ healthy: true, total: 0, delivered: 0, ratio: 1 }),
  getWarmupDailyLimit: vi.fn().mockImplementation(async (_id: string, configured: number) => configured),
  jitteredSendDelayMs: vi.fn().mockReturnValue(0),
}))

// Generic chainable query-builder mock: every filter method (eq/lt/lte/order/
// limit) just records itself and returns `this`, so any call order the real
// code uses works. `update(patch)` applies `patch` to `queueRow` ONLY if
// `queueRow.id` matches an `.eq('id', ...)` filter AND every OTHER recorded
// `.eq(col, val)` filter still matches `queueRow`'s CURRENT state at the
// moment the chain is finally awaited — this is what faithfully reproduces
// Postgres's row-level `UPDATE ... WHERE status='pending'` atomicity: two
// concurrent chains built from the same starting snapshot each re-check the
// live row when they resolve, so only the one that runs first can match.
function makeQueryChain(table: string, mode: 'select' | 'update', patch?: Record<string, unknown>) {
  const filters: Array<{ col: string; val: unknown; op: 'eq' | 'lt' }> = []
  const chain: any = {
    eq: (col: string, val: unknown) => { filters.push({ col, val, op: 'eq' }); return chain },
    lt: (col: string, val: unknown) => { filters.push({ col, val, op: 'lt' }); return chain },
    lte: () => chain,
    order: () => chain,
    limit: () => resolveChain(),
    select: () => resolveChain(),
    maybeSingle: () => resolveChain().then((r: any) => ({ data: r.data?.[0] ?? { sent_count: 0, status: 'running' }, error: r.error })),
    then: (resolve: any, reject: any) => resolveChain().then(resolve, reject),
  }
  function matches(row: QueueRow) {
    return filters.every(f => f.op === 'eq' ? (row as any)[f.col] === f.val : true)
  }
  function resolveChain(): Promise<any> {
    if (table !== 'campaign_send_queue') return Promise.resolve({ data: [], error: null })
    if (mode === 'select') {
      return Promise.resolve({
        data: matches(queueRow) ? [{
          ...queueRow,
          campaign: { id: queueRow.campaign_id, status: 'running', campaign_type: 'reminder', message_template: null, sent_count: 0, send_window_start: null, send_window_end: null },
          customer: { phone: '966500000001', whatsapp: '966500000001' },
          whatsapp_number: { id: 'num-1', instance_name: 'default', api_url: 'http://waha', daily_limit: 200, sent_today: 0, last_sent_at: null, is_active: true },
        }] : [],
        error: null,
      })
    }
    // update mode
    const isMatch = matches(queueRow)
    if (isMatch && patch) Object.assign(queueRow, patch)
    return Promise.resolve({ data: isMatch ? [{ id: queueRow.id }] : [], error: null })
  }
  return chain
}

function makeFakeSupabase() {
  return {
    from: (table: string) => ({
      select: () => makeQueryChain(table, 'select'),
      update: (patch: Partial<QueueRow>) => makeQueryChain(table, 'update', patch as Record<string, unknown>),
      insert: () => Promise.resolve({ error: null }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => makeFakeSupabase() }))

function makeReq() {
  return { headers: { get: (name: string) => (name === 'authorization' ? `Bearer ${process.env.APP_SECRET}` : null) } } as any
}

describe('send-campaign-queue — concurrent invocations never double-send the same row', () => {
  beforeEach(() => {
    // The real route enforces a 10s pacing delay between sends (see
    // MIN_DELAY_BETWEEN_SENDS_MS — the WhatsApp-ban burst-rate fix). That
    // delay is a real production safety measure, not something these tests
    // are exercising, so make it instant here to keep the suite fast.
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as any })
    sentCalls = 0
    queueRow = {
      id: 'row-1', company_id: 'c1', campaign_id: 'camp-1', recipient_id: 'rec-1',
      customer_id: 'cust-1', debt_id: 'debt-1', message_text: null,
      attempts: 0, max_attempts: 3, status: 'pending',
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    }
    vi.resetModules()
  })

  afterEach(() => {
    // Restore the real global setTimeout — vi.stubGlobal otherwise leaks
    // across other test files sharing this worker (broke @testing-library's
    // waitFor, which relies on real timers, in unrelated component tests).
    vi.unstubAllGlobals()
  })

  it('sends exactly once when the route is invoked twice concurrently for the same pending row', async () => {
    const { GET } = await import('@/app/api/cron/send-campaign-queue/route')
    const [r1, r2] = await Promise.all([GET(makeReq()), GET(makeReq())])
    const [j1, j2] = await Promise.all([r1.json(), r2.json()])

    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(j1.results.sent + j2.results.sent).toBe(1)
    expect(queueRow.status).toBe('sent')
  })

  it('spends zero attempts and sends nothing when the health circuit breaker reports the WhatsApp session is down', async () => {
    const sendGate = await import('@/lib/send-gate')
    vi.mocked(sendGate.isWhatsAppSessionHealthy).mockResolvedValueOnce(false)

    const { GET } = await import('@/app/api/cron/send-campaign-queue/route')
    const res = await GET(makeReq())
    const json = await res.json()

    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled()
    expect(json.results.skipped_unhealthy_session).toBe(true)
    expect(queueRow.status).toBe('pending') // untouched — no attempt spent, no LLM call, no WAHA request
  })
})
