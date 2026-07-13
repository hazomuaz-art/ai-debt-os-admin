import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Root-cause regression test (2026-07-13, real production incident): a
// campaign auto-paused by the delivery-quality circuit breaker (or paused
// manually from the dashboard) kept leaking real WhatsApp sends for ~20
// hours afterward, because this route never checked the parent campaign's
// own `status` before draining a still-pending queue row — only the INLINE
// quality gate for that specific run mattered, and a quiet window with too
// few recent sends to evaluate reads as trivially "healthy". Confirmed live
// against real data: a campaign paused at 11:25 on 2026-07-12 still sent a
// message at 07:40 the next day. This proves the fix: a queue row whose
// campaign is not 'running' must never be sent, regardless of the quality
// gate's verdict.

type QueueRow = {
  id: string; company_id: string; campaign_id: string; recipient_id: string
  customer_id: string; debt_id: string; message_text: string | null
  attempts: number; max_attempts: number; status: string; scheduled_at: string
}

let queueRow: QueueRow
let campaignStatus: string

const mockSendWhatsAppMessage = vi.fn().mockImplementation(async () => ({ status: 'sent', message_id: 'wam-1' }))
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: (...args: any[]) => mockSendWhatsAppMessage(...args) }))
vi.mock('@/lib/campaign-message', () => ({ generateCampaignMessage: vi.fn().mockResolvedValue('رسالة تجريبية') }))
// The quality gate reads HEALTHY here on purpose — this is exactly the real
// incident's condition (a quiet window looks fine) and the point of this
// test is that the campaign's own paused status must block the send anyway,
// independent of what the quality gate says.
vi.mock('@/lib/send-gate', () => ({
  isWhatsAppSessionHealthy: vi.fn().mockResolvedValue(true),
  canSendUnpromptedMessage: vi.fn().mockResolvedValue({ allowed: true }),
  isDeliveryQualityHealthy: vi.fn().mockResolvedValue({ healthy: true, total: 0, delivered: 0, ratio: 1 }),
  getWarmupDailyLimit: vi.fn().mockImplementation(async (_id: string, configured: number) => configured),
  jitteredSendDelayMs: vi.fn().mockReturnValue(0),
}))

function makeQueryChain(table: string, mode: 'select' | 'update', patch?: Record<string, unknown>) {
  const filters: Array<{ col: string; val: unknown }> = []
  const chain: any = {
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return chain },
    lt: () => chain,
    lte: () => chain,
    order: () => chain,
    limit: () => resolveChain(),
    select: () => resolveChain(),
    maybeSingle: () => resolveChain().then((r: any) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })),
    then: (resolve: any, reject: any) => resolveChain().then(resolve, reject),
  }
  function matches(row: QueueRow) {
    return filters.every(f => (row as any)[f.col] === f.val)
  }
  function resolveChain(): Promise<any> {
    // The final sentCountDelta bookkeeping (after a successful send) reads
    // `campaigns.sent_count/status/started_at` back via .maybeSingle() — not
    // exercised by the pause path (nothing sends), only by the control case.
    if (table === 'campaigns' && mode === 'select') {
      return Promise.resolve({ data: [{ sent_count: 0, status: campaignStatus, started_at: null }], error: null })
    }
    if (table !== 'campaign_send_queue') return Promise.resolve({ data: [], error: null })
    if (mode === 'select') {
      return Promise.resolve({
        data: matches(queueRow) ? [{
          ...queueRow,
          campaign: { id: queueRow.campaign_id, status: campaignStatus, campaign_type: 'reminder', message_template: null, sent_count: 0, send_window_start: null, send_window_end: null },
          customer: { phone: '966500000001', whatsapp: '966500000001' },
          whatsapp_number: { id: 'num-1', instance_name: 'default', api_url: 'http://waha', daily_limit: 200, sent_today: 0, last_sent_at: null, is_active: true },
        }] : [],
        error: null,
      })
    }
    const isMatch = matches(queueRow)
    if (isMatch && patch) Object.assign(queueRow, patch)
    return Promise.resolve({ data: isMatch ? [{ id: queueRow.id }] : [], error: null })
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => makeQueryChain(table, 'select'),
      update: (patch: Partial<QueueRow>) => makeQueryChain(table, 'update', patch as Record<string, unknown>),
      insert: () => Promise.resolve({ error: null }),
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}))

function makeReq() {
  return { headers: { get: (name: string) => (name === 'authorization' ? `Bearer ${process.env.APP_SECRET}` : null) } } as any
}

describe('send-campaign-queue — a paused campaign never leaks a send, regardless of the quality gate', () => {
  beforeEach(() => {
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as any })
    queueRow = {
      id: 'row-1', company_id: 'c1', campaign_id: 'camp-1', recipient_id: 'rec-1',
      customer_id: 'cust-1', debt_id: 'debt-1', message_text: null,
      attempts: 0, max_attempts: 3, status: 'pending',
      scheduled_at: new Date(Date.now() - 1000).toISOString(),
    }
    mockSendWhatsAppMessage.mockClear()
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a pending row whose campaign is "paused" is skipped, never sent, even though the quality gate reads healthy', async () => {
    campaignStatus = 'paused'
    const { GET } = await import('@/app/api/cron/send-campaign-queue/route')
    const res = await GET(makeReq())
    const json = await res.json()

    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled()
    expect(json.results.sent).toBe(0)
    expect(json.results.skipped_paused).toBe(1)
    expect(queueRow.status).toBe('skipped')
    expect(queueRow.error).toBe('campaign_not_running')
  })

  it('a pending row whose campaign is "running" sends normally (control case — the fix does not block legitimate sends)', async () => {
    campaignStatus = 'running'
    const { GET } = await import('@/app/api/cron/send-campaign-queue/route')
    const res = await GET(makeReq())
    const json = await res.json()

    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(json.results.sent).toBe(1)
    expect(queueRow.status).toBe('sent')
  })
})
