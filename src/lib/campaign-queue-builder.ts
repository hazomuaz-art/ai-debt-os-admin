import { createLogger } from '@/lib/logger'

const log = createLogger('campaign-queue-builder')

export type CampaignQueueDebt = {
  id: string
  customer_id: string | null
  status: string
  current_balance: number | null
  priority: string | null
}

// Shared write path for both campaign-targeting entry points — the
// portfolio-wide builder (every eligible debt in a portfolio) and the
// Excel-upload builder (an admin-picked specific customer list). Only the
// debt list differs between callers; the recipients/queue/campaign-progress
// writes themselves must stay identical so both paths get the same
// personalization-at-send-time behavior (message_text left null) and the
// same daily-limit/window handling downstream in send-campaign-queue.
export async function buildCampaignQueueRows(args: {
  supabase: any
  company_id: string
  campaign_id: string
  portfolio_id: string
  whatsapp_number_id: string
  debts: CampaignQueueDebt[]
  source: string
  campaign_target_count: number
  campaign_status: string
}): Promise<{ recipients_created: number; queue_created: number }> {
  const { supabase, company_id, campaign_id, portfolio_id, whatsapp_number_id, debts, source } = args

  const rows = debts
    .filter(debt => debt.customer_id)
    .map(debt => ({
      company_id,
      campaign_id,
      portfolio_id,
      customer_id: debt.customer_id,
      debt_id: debt.id,
      whatsapp_number_id,
      status: 'queued',
      priority: debt.priority === 'high' ? 90 : debt.priority === 'urgent' ? 100 : 50,
      scheduled_at: new Date().toISOString(),
      metadata: {
        source,
        debt_status: debt.status,
        current_balance: debt.current_balance,
      },
    }))

  if (rows.length === 0) return { recipients_created: 0, queue_created: 0 }

  const { data: recipients, error: recipientsError } = await supabase
    .from('campaign_recipients')
    .upsert(rows, { onConflict: 'campaign_id,customer_id,debt_id' })
    .select('*')
  if (recipientsError) throw new Error(recipientsError.message)

  const queueRows = (recipients ?? []).map((recipient: any, index: number) => ({
    company_id,
    campaign_id,
    recipient_id: recipient.id,
    portfolio_id,
    whatsapp_number_id,
    customer_id: recipient.customer_id,
    debt_id: recipient.debt_id,
    channel: 'whatsapp',
    status: 'pending',
    // Left null deliberately: send-campaign-queue generates a message
    // personalized to THIS customer's balance/score/case-note at send time
    // instead of every recipient getting the exact same static text.
    message_text: null,
    scheduled_at: new Date(Date.now() + index * 60000).toISOString(),
    metadata: { source, portfolio_id },
  }))

  const { error: queueError } = await supabase.from('campaign_send_queue').insert(queueRows)
  if (queueError) throw new Error(queueError.message)

  const { error: campaignUpdErr } = await supabase
    .from('campaigns')
    .update({
      target_count: (args.campaign_target_count ?? 0) + rows.length,
      status: args.campaign_status === 'draft' ? 'scheduled' : args.campaign_status,
    })
    .eq('id', campaign_id)
    .eq('company_id', company_id)
  if (campaignUpdErr) log.error('campaign status/target_count update failed', new Error(campaignUpdErr.message), { campaign_id })

  return { recipients_created: recipients?.length ?? 0, queue_created: queueRows.length }
}
