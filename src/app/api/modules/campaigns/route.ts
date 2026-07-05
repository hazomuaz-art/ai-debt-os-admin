import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

export async function GET(_req: NextRequest) {
  return withAuth(async (ctx) => {
    const { data, error } = await ctx.supabase
      .from('campaigns')
      .select('*')
      .eq('company_id', ctx.profile.company_id)
      .order('created_at', { ascending: false })
    if (error) return errors.internal(error.message)

    // Real gap found during a full-system audit: target_count/sent_count are
    // denormalized counters incremented by campaign-builder/upload-targets
    // (target_count) and send-campaign-queue (sent_count) — they only ever
    // go up, so anything that removes rows from campaign_recipients/
    // campaign_send_queue afterward (e.g. the dedup cleanup migration that
    // deleted duplicate queue rows) leaves the stored counters permanently
    // overstated with no code path that ever corrects them. Overriding with
    // a live count on every read makes the displayed numbers self-healing
    // regardless of how the underlying rows changed, instead of trusting a
    // counter that can silently drift out of sync.
    const campaigns = data ?? []
    if (campaigns.length > 0) {
      const campaignIds = campaigns.map((c: any) => c.id)
      const [{ data: recipientRows }, { data: sentRows }] = await Promise.all([
        ctx.supabase.from('campaign_recipients').select('campaign_id').in('campaign_id', campaignIds),
        ctx.supabase.from('campaign_send_queue').select('campaign_id').in('campaign_id', campaignIds).eq('status', 'sent'),
      ])
      const realTargetCount = new Map<string, number>()
      for (const r of recipientRows ?? []) realTargetCount.set(r.campaign_id, (realTargetCount.get(r.campaign_id) ?? 0) + 1)
      const realSentCount = new Map<string, number>()
      for (const r of sentRows ?? []) realSentCount.set(r.campaign_id, (realSentCount.get(r.campaign_id) ?? 0) + 1)
      for (const c of campaigns as any[]) {
        c.target_count = realTargetCount.get(c.id) ?? 0
        c.sent_count = realSentCount.get(c.id) ?? 0
      }
    }

    return NextResponse.json({ data: campaigns })
  })
}

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: Record<string, unknown>
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }
      const { data, error } = await ctx.supabase
        .from('campaigns')
        .insert({ ...body, company_id: ctx.profile.company_id, created_by: ctx.user.id })
        .select().single()
      if (error) return errors.internal(error.message)
      return NextResponse.json({ data }, { status: 201 })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
