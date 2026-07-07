import { describe, it, expect, vi, beforeEach } from 'vitest'

// Proves the Meta-policy auto-pause: if this cron's own inline delivery-
// quality check sees a degrading ratio, it must PAUSE every running
// campaign outright (not just skip a row) and send zero further messages
// in that same run. This is the fix for the actual root cause of this
// number's two real WhatsApp silent blocks (2026-06-30, 2026-07-06) — both
// times, the campaign kept sending well past the point where delivery had
// already started failing.

let mockAlertsInserted: any[]
const mockSendWhatsAppMessage = vi.fn()
vi.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: (...args: any[]) => mockSendWhatsAppMessage(...args) }))
vi.mock('@/lib/campaign-message', () => ({ generateCampaignMessage: vi.fn().mockResolvedValue('x') }))
vi.mock('@/lib/system-alerts', () => ({
  insertSystemAlert: vi.fn().mockImplementation(async (row: any) => { mockAlertsInserted.push(row) }),
}))
vi.mock('@/lib/send-gate', () => ({
  isWhatsAppSessionHealthy: vi.fn().mockResolvedValue(true),
  isDeliveryQualityHealthy: vi.fn().mockResolvedValue({ healthy: false, total: 8, delivered: 2, ratio: 0.25 }),
  canSendUnpromptedMessage: vi.fn().mockResolvedValue({ allowed: true }),
  getWarmupDailyLimit: vi.fn().mockImplementation(async (_id: string, configured: number) => configured),
  jitteredSendDelayMs: vi.fn().mockReturnValue(0),
}))

let runningCampaigns: { id: string; status: string }[]

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'campaigns') {
        return {
          select: () => ({
            eq: (col: string, val: string) => Promise.resolve({
              data: col === 'status' && val === 'running' ? runningCampaigns.filter(c => c.status === 'running') : [],
              error: null,
            }),
          }),
          update: (patch: { status: string }) => ({
            eq: (_col: string, val: string) => {
              const c = runningCampaigns.find(c => c.id === val)
              if (c) c.status = patch.status
              return Promise.resolve({ error: null })
            },
          }),
        }
      }
      // campaign_send_queue select should never even be reached — the quality
      // gate returns before the batch fetch.
      return { select: () => ({ eq: () => ({ lte: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }), update: () => ({ eq: () => Promise.resolve({ error: null }) }) }
    },
  }),
}))

function makeReq() {
  return { headers: { get: (name: string) => (name === 'authorization' ? `Bearer ${process.env.APP_SECRET}` : null) } } as any
}

describe('send-campaign-queue — auto-pauses running campaigns on delivery-quality degradation', () => {
  beforeEach(() => {
    mockAlertsInserted = []
    runningCampaigns = [{ id: 'camp-1', status: 'running' }, { id: 'camp-2', status: 'running' }]
    vi.resetModules()
  })

  it('pauses every running campaign, sends zero messages, and raises a critical alert', async () => {
    const { GET } = await import('@/app/api/cron/send-campaign-queue/route')
    const res = await GET(makeReq())
    const json = await res.json()

    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled()
    expect(json.results.sent).toBe(0)
    expect(runningCampaigns.every(c => c.status === 'paused')).toBe(true)
    expect(mockAlertsInserted).toHaveLength(1)
    expect(mockAlertsInserted[0].severity).toBe('critical')
    expect(mockAlertsInserted[0].alert_type).toBe('campaign_auto_paused_quality')
  })
})
