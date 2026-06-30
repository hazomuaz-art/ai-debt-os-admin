import { createServiceClient } from '@/lib/supabase/server'
import { insertApproval } from '@/lib/approvals'
import { createLogger } from '@/lib/logger'

const log = createLogger('installment-request')

/**
 * Records a customer's explicit installment request and opens the matching
 * admin approval — the approval dashboard's PATCH handler
 * (src/app/api/modules/approvals/route.ts) already fully handles notifying
 * the customer of the admin's decision (approved/rejected) once reviewed;
 * this was simply never called, so requests never reached an admin at all.
 * Deduplicates against an existing open request for the same debt.
 */
export async function recordInstallmentRequest(args: {
  company_id: string
  customer_id: string
  customer_name?: string | null
  debt_id: string
  customer_message: string
  agent_reason?: string
}): Promise<void> {
  const supabase = createServiceClient()

  // 'payment_plan' was never a valid approvals.approval_type (the real
  // CHECK constraint only allows large_settlement/discount/
  // legal_escalation/stop_followup/write_off/ai_learning/campaign_launch/
  // custom) — every installment request built this session has been
  // failing to save silently since it shipped, despite the log line below
  // claiming success. Found during the full-system constraint audit.
  const { data: existing } = await supabase
    .from('approvals')
    .select('id')
    .eq('company_id', args.company_id)
    .eq('entity_type', 'debts').eq('entity_id', args.debt_id)
    .eq('approval_type', 'custom')
    .eq('status', 'pending')
    .limit(1).maybeSingle()
  if (existing) {
    log.info('installment request already pending for this debt — skipping duplicate', { debt_id: args.debt_id })
    return
  }

  const { data: debt } = await supabase
    .from('debts').select('current_balance, currency').eq('id', args.debt_id).maybeSingle()

  const created = await insertApproval({
    company_id: args.company_id, approval_type: 'custom', entity_type: 'debts', entity_id: args.debt_id,
    title: `طلب تقسيط: ${args.customer_name ?? ''}`,
    description: [
      `العميل يطلب التقسيط لمديونية بقيمة ${debt?.current_balance ?? ''} ${debt?.currency ?? ''}.`,
      `كلام العميل: "${args.customer_message}"`,
      args.agent_reason ? `تقييم الوكيل: ${args.agent_reason}` : null,
    ].filter(Boolean).join('\n'),
    priority: 'medium',
    requested_data: {
      customer_id: args.customer_id, reason: args.customer_message, agent_reason: args.agent_reason ?? null,
      request_subtype: 'installment',
    },
  })

  if (!created) log.error('installment request insert failed', new Error('insertApproval returned null'), { debt_id: args.debt_id })
  else log.info('installment request recorded', { debt_id: args.debt_id })
}
