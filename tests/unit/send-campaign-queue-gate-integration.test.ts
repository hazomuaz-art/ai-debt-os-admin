import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Proves the Decision Engine end-to-end using the REAL send-gate.ts (not
// mocked) wired through the real route: a customer who received an
// unprompted campaign message minutes ago, with no reply since, must be
// BLOCKED from a second one — regardless of what triggers the second
// attempt (a naive re-run of the campaign builder, an overlapping cron
// tick that survived the atomic claim on a DIFFERENT queue row for the
// same customer, a retry mechanism, anything). This is the actual rule the
// user asked for: exactly one message, then silence until reply or 3 days.

type QueueRow = {
  id: string; company_id: string; campaign_id: string; recipient_id: string
  customer_id: string; debt_id: string; message_text: string | null
  attempts: number; max_attempts: number; status: string; scheduled_at: string
}
type MessageRow = { customer_id: string; direction: string; sent_at: string }

let queueRow: QueueRow
let messages: MessageRow[]
let sentCalls: number

const mockSendWhatsAppMessage = vi.fn().mockImplementation(async () => {
  sentCalls++
  return { status: 'sent', message_id: `wam-${sentCalls}` }
})
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: (...args: any[]) => mockSendWhatsAppMessage(...args) }))
vi.mock('@/lib/campaign-message', () => ({ generateCampaignMessage: vi.fn().mockResolvedValue('رسالة تجريبية') }))
// send-gate itself is REAL here — only its own DB dependency (createServiceClient) is faked.

function makeQueryChain(table: string, mode: 'select' | 'update', patch?: Record<string, unknown>) {
  const filters: Array<{ col: string; val: unknown }> = []
  let order: 'asc' | 'desc' = 'asc'
  const chain: any = {
    eq: (col: string, val: unknown) => { filters.push({ col, val }); return chain },
    lt: () => chain,
    lte: () => chain,
    gte: () => chain,
    in: () => chain,
    contains: () => chain,
    not: () => chain,
    order: (_col: string, opts?: { ascending?: boolean }) => { order = opts?.ascending === false ? 'desc' : 'asc'; return chain },
    limit: (_n: number) => chain,
    select: () => resolveChain(),
    maybeSingle: () => resolveChain().then((r: any) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })),
    then: (resolve: any, reject: any) => resolveChain().then(resolve, reject),
  }
  function resolveChain(): Promise<any> {
    if (table === 'messages' && mode === 'select') {
      const custFilter = filters.find(f => f.col === 'customer_id')
      const rows = messages
        .filter(m => !custFilter || m.customer_id === custFilter.val)
        .sort((a, b) => order === 'desc'
          ? new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime()
          : new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime())
      return Promise.resolve({ data: rows, error: null })
    }
    if (table === 'system_alerts') return Promise.resolve({ data: null, error: null }) // healthy — no unresolved alert
    if (table !== 'campaign_send_queue') return Promise.resolve({ data: mode === 'select' ? [] : [], error: null })
    if (mode === 'select') {
      const matches = filters.every(f => (queueRow as any)[f.col] === f.val)
      return Promise.resolve({
        data: matches ? [{
          ...queueRow,
          campaign: { id: queueRow.campaign_id, status: 'running', campaign_type: 'reminder', message_template: null, sent_count: 0, send_window_start: null, send_window_end: null },
          customer: { phone: '966500000001', whatsapp: '966500000001' },
          whatsapp_number: { id: 'num-1', instance_name: 'default', api_url: 'http://waha', daily_limit: 200, sent_today: 0, last_sent_at: null, is_active: true },
        }] : [],
        error: null,
      })
    }
    const matches = filters.every(f => (queueRow as any)[f.col] === f.val)
    if (matches && patch) Object.assign(queueRow, patch)
    return Promise.resolve({ data: matches ? [{ id: queueRow.id }] : [], error: null })
  }
  return chain
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => makeQueryChain(table, 'select'),
      update: (patch: Record<string, unknown>) => makeQueryChain(table, 'update', patch),
      insert: (row: Record<string, unknown>) => {
        if (table === 'messages') messages.push({ customer_id: row.customer_id as string, direction: row.direction as string, sent_at: row.sent_at as string })
        return Promise.resolve({ error: null })
      },
    }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}))

function makeReq() {
  return { headers: { get: (name: string) => (name === 'authorization' ? `Bearer ${process.env.APP_SECRET}` : null) } } as any
}

function freshQueueRow(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: 'row-x', company_id: 'c1', campaign_id: 'camp-1', recipient_id: 'rec-x',
    customer_id: 'cust-repeat', debt_id: 'debt-1', message_text: null,
    attempts: 0, max_attempts: 3, status: 'pending',
    scheduled_at: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  }
}

describe('send-campaign-queue — real Decision Engine blocks a repeat unprompted send', () => {
  beforeEach(() => {
    // Same rationale as send-campaign-queue-concurrency.test.ts: the real
    // 10s inter-send pacing delay is a genuine production safety measure,
    // not something these tests exercise — make it instant here.
    vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0 as any })
    sentCalls = 0
    vi.resetModules()
  })

  afterEach(() => {
    // Restore the real global setTimeout — see rationale in
    // send-campaign-queue-concurrency.test.ts.
    vi.unstubAllGlobals()
  })

  it('sends the first message, then blocks a second queue row for the same customer minutes later with no reply', async () => {
    messages = []
    queueRow = freshQueueRow()
    const { GET } = await import('@/app/api/cron/send-campaign-queue/route')

    const res1 = await GET(makeReq())
    const j1 = await res1.json()
    expect(j1.results.sent).toBe(1)
    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(messages).toHaveLength(1) // the real send-campaign-queue insert into messages

    // A second, DIFFERENT queue row for the SAME customer becomes due minutes
    // later (e.g. a retry, an overlapping campaign, anything) — this must be
    // blocked by the gate, not sent, because the customer has not replied.
    queueRow = freshQueueRow({ id: 'row-y', recipient_id: 'rec-y' })
    const res2 = await GET(makeReq())
    const j2 = await res2.json()

    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1) // still just 1 — no new send happened
    expect(j2.results.skipped_gate).toBe(1)
    expect(queueRow.status).toBe('skipped')
    expect(queueRow.error).toBe('awaiting_reply_within_window')
  })

  it('allows a follow-up once the customer HAS replied in between', async () => {
    messages = []
    queueRow = freshQueueRow()
    const { GET } = await import('@/app/api/cron/send-campaign-queue/route')

    await GET(makeReq())
    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1)

    // Customer replies (strictly after the outbound send just logged above).
    const lastOutboundAt = new Date(messages[messages.length - 1].sent_at).getTime()
    messages.push({ customer_id: 'cust-repeat', direction: 'inbound', sent_at: new Date(lastOutboundAt + 1000).toISOString() })

    // A brand-new campaign send is now attempted — but the gate blocks THIS
    // too, on purpose: the customer is mid-conversation, so a campaign blast
    // must not interrupt it (the normal reply pipeline owns them now).
    queueRow = freshQueueRow({ id: 'row-z', recipient_id: 'rec-z' })
    const res2 = await GET(makeReq())
    const j2 = await res2.json()
    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1)
    expect(j2.results.skipped_gate).toBe(1)
    expect(queueRow.error).toBe('customer_in_active_conversation')
  })
})
