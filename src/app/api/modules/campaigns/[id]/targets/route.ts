import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

// Closes the loop between the Campaigns page and the actual debts/customers
// a campaign touches. Previously a campaign showed only aggregate counts
// (target_count, sent_count, response_count...) with zero drill-down — an
// admin had no way to see WHICH customers/debts were part of a campaign, or
// to jump to a targeted debt's full history. The send/message pipeline
// already records debt_id per queue row (see cron/send-campaign-queue), this
// endpoint just exposes it.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return withAuth(async (ctx) => {
    const { data: campaign } = await ctx.supabase
      .from('campaigns')
      .select('id')
      .eq('id', params.id)
      .eq('company_id', ctx.profile.company_id)
      .maybeSingle()
    if (!campaign) return errors.notFound('Campaign')

    const { data, error } = await ctx.supabase
      .from('campaign_send_queue')
      .select(`
        id, status, channel, processed_at, error,
        customer:customers(id, full_name, phone, whatsapp),
        debt:debts(id, reference_number, current_balance, currency)
      `)
      .eq('campaign_id', params.id)
      .eq('company_id', ctx.profile.company_id)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return errors.internal(error.message)

    return NextResponse.json({ data: data ?? [] })
  })
}
