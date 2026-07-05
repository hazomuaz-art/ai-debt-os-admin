import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'
import { buildCampaignQueueRows } from '@/lib/campaign-queue-builder'

const buildSchema = z.object({
  campaign_id: z.string().uuid(),
  portfolio_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(5000).default(250),
})

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = buildSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { campaign_id, portfolio_id, limit } = parsed.data

      const { data: campaign, error: campaignError } = await ctx.supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaign_id)
        .eq('company_id', ctx.profile.company_id)
        .maybeSingle()

      if (campaignError) return errors.internal(campaignError.message)
      if (!campaign) return errors.notFound('Campaign')

      const targetPortfolioId = portfolio_id ?? campaign.portfolio_id ?? null
      if (!targetPortfolioId) {
        return errors.badRequest('portfolio_id required until campaign has portfolio_id')
      }

      const { data: whatsappNumber, error: numberError } = await ctx.supabase
        .from('portfolio_whatsapp_numbers')
        .select('*')
        .eq('company_id', ctx.profile.company_id)
        .eq('portfolio_id', targetPortfolioId)
        .eq('is_active', true)
        .order('sent_today', { ascending: true })
        .limit(1)
        .maybeSingle()

      if (numberError) return errors.internal(numberError.message)
      if (!whatsappNumber) return errors.badRequest('No active WhatsApp number linked to this portfolio')

      const { data: debts, error: debtsError } = await ctx.supabase
        .from('debts')
        .select('id, customer_id, portfolio_id, status, current_balance, priority, next_follow_up')
        .eq('company_id', ctx.profile.company_id)
        .eq('portfolio_id', targetPortfolioId)
        .not('status', 'in', '("settled","written_off")')
        .limit(limit)

      if (debtsError) return errors.internal(debtsError.message)

      if (!debts || debts.length === 0) {
        return NextResponse.json({
          data: {
            campaign_id,
            portfolio_id: targetPortfolioId,
            recipients_created: 0,
            queue_created: 0,
            message: 'No eligible debts found for this portfolio',
          },
        })
      }

      let result: { recipients_created: number; queue_created: number }
      try {
        result = await buildCampaignQueueRows({
          supabase: ctx.supabase,
          company_id: ctx.profile.company_id,
          campaign_id,
          portfolio_id: targetPortfolioId,
          whatsapp_number_id: whatsappNumber.id,
          debts: debts as any,
          source: 'campaign_builder',
          campaign_target_count: campaign.target_count ?? 0,
          campaign_status: campaign.status,
        })
      } catch (err) {
        return errors.internal(err instanceof Error ? err.message : String(err))
      }

      return NextResponse.json({
        data: {
          campaign_id,
          portfolio_id: targetPortfolioId,
          whatsapp_number_id: whatsappNumber.id,
          ...result,
        },
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
