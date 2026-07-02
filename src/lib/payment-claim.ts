import { createServiceClient } from '@/lib/supabase/server'
import { insertApproval } from '@/lib/approvals'
import { createLogger } from '@/lib/logger'

const log = createLogger('payment-claim')

/**
 * Records a customer's claim of having already paid/transferred — mirrors
 * the dispute.ts/installment-request.ts pattern (real customer context,
 * request_subtype for the approvals dashboard to act on, dedup against an
 * existing open request). Previously this only ever produced a bare
 * approval_type='stop_followup' approval with no request_subtype, which the
 * approvals PATCH route had no way to act on — approving/rejecting it did
 * nothing, and nothing stopped it firing again on the customer's next reply.
 */
export async function recordPaymentClaim(args: {
  company_id: string
  customer_id: string
  customer_name?: string | null
  debt_id: string
  customer_message: string
}): Promise<void> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('approvals')
    .select('id')
    .eq('company_id', args.company_id)
    .eq('entity_type', 'debt').eq('entity_id', args.debt_id)
    .eq('status', 'pending')
    .eq('requested_data->>request_subtype', 'payment_claim')
    .limit(1).maybeSingle()
  if (existing) {
    log.info('payment claim already pending for this debt — skipping duplicate', { debt_id: args.debt_id })
    return
  }

  const { data: debt } = await supabase
    .from('debts').select('current_balance, currency').eq('id', args.debt_id).maybeSingle()

  const created = await insertApproval({
    company_id: args.company_id, approval_type: 'custom', entity_type: 'debt', entity_id: args.debt_id,
    title: `إفادة سداد: ${args.customer_name ?? ''}`,
    description: [
      `العميل يفيد بأنه سدد/حوّل مبلغ الدين (الرصيد الحالي المسجل: ${debt?.current_balance ?? ''} ${debt?.currency ?? ''}).`,
      `كلام العميل: "${args.customer_message}"`,
      `القرار: الموافقة = تأكيد استلام السداد وإيقاف المتابعة الآلية لحين مطابقة الإيصال. الرفض = لا يوجد سداد مطابق، استئناف التحصيل الاعتيادي.`,
    ].join('\n'),
    priority: 'urgent',
    requested_data: {
      customer_id: args.customer_id, message: args.customer_message,
      request_subtype: 'payment_claim',
    },
    expires_at: new Date(Date.now() + 24 * 3600000).toISOString(),
  })

  if (!created) log.error('payment claim insert failed', new Error('insertApproval returned null'), { debt_id: args.debt_id })
  else log.info('payment claim recorded', { debt_id: args.debt_id })
}
