import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/campaign-builder')

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

      const rows = (debts ?? [])
        .filter((debt: any) => debt.customer_id)
        .map((debt: any) => ({
          company_id: ctx.profile.company_id,
          campaign_id,
          portfolio_id: targetPortfolioId,
          customer_id: debt.customer_id,
          debt_id: debt.id,
          whatsapp_number_id: whatsappNumber.id,
          status: 'queued',
          priority: debt.priority === 'high' ? 90 : debt.priority === 'urgent' ? 100 : 50,
          scheduled_at: new Date().toISOString(),
          metadata: {
            source: 'campaign_builder',
            debt_status: debt.status,
            current_balance: debt.current_balance,
          },
        }))

      if (rows.length === 0) {
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

      const { data: recipients, error: recipientsError } = await ctx.supabase
        .from('campaign_recipients')
        .upsert(rows, { onConflict: 'campaign_id,customer_id,debt_id' })
        .select('*')

      if (recipientsError) return errors.internal(recipientsError.message)

      const queueRows = (recipients ?? []).map((recipient: any, index: number) => ({
        company_id: ctx.profile.company_id,
        campaign_id,
        recipient_id: recipient.id,
        portfolio_id: targetPortfolioId,
        whatsapp_number_id: whatsappNumber.id,
        customer_id: recipient.customer_id,
        debt_id: recipient.debt_id,
        channel: 'whatsapp',
        status: 'pending',
        message_text: campaign.message_template ?? null,
        scheduled_at: new Date(Date.now() + index * 60000).toISOString(),
        metadata: {
          source: 'campaign_builder',
          portfolio_id: targetPortfolioId,
        },
      }))

      const { error: queueError } = await ctx.supabase
        .from('campaign_send_queue')
        .insert(queueRows)

      if (queueError) return errors.internal(queueError.message)

      // Real gap found during a full-system audit: unchecked, unlike its
      // sibling recipients/queue writes above — a rejected update leaves the
      // campaign stuck at 'draft' even though its recipients were already
      // queued, breaking any status-gated dashboard/automation downstream.
      const { error: campaignUpdErr } = await ctx.supabase
        .from('campaigns')
        .update({
          target_count: (campaign.target_count ?? 0) + rows.length,
          status: campaign.status === 'draft' ? 'scheduled' : campaign.status,
        })
        .eq('id', campaign_id)
        .eq('company_id', ctx.profile.company_id)
      if (campaignUpdErr) log.error('campaign status/target_count update failed', new Error(campaignUpdErr.message), { campaign_id })

      return NextResponse.json({
        data: {
          campaign_id,
          portfolio_id: targetPortfolioId,
          whatsapp_number_id: whatsappNumber.id,
          recipients_created: recipients?.length ?? 0,
          queue_created: queueRows.length,
        },
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
