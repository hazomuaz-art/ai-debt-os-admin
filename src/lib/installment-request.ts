import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('installment-request')

/**
 * Records a customer-initiated installment request the agent decided to
 * raise for admin review (action=record_installment_request). Never auto-
 * approves anything and never touches debts.status — review-only, exactly
 * what the agent told the customer it would do.
 *
 * Usable from any WhatsApp gateway webhook (WAHA).
 */
export async function recordInstallmentRequest(args: {
  company_id: string
  customer_id: string
  customer_name?: string | null
  debt_id: string
  customer_message: string
  agent_message?: string | null
}): Promise<void> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('approvals')
    .select('id')
    .eq('company_id', args.company_id)
    .eq('entity_type', 'debt')
    .eq('entity_id', args.debt_id)
    .eq('status', 'pending')
    .contains('requested_data', { kind: 'installment_request' })
    .limit(1).maybeSingle()
  if (existing) {
    log.info('installment request already pending for this debt — skipping duplicate', { debt_id: args.debt_id })
    return
  }

  const description = [
    `كلام العميل: "${args.customer_message}"`,
    args.agent_message ? `رد الوكيل: ${args.agent_message}` : null,
  ].filter(Boolean).join('\n')

  // approval_type CHECK constraint has no dedicated value for installment
  // requests — 'custom' is the documented catch-all bucket, so this never
  // risks an insert failure the way an undeclared enum value would.
  await supabase.from('approvals').insert({
    company_id: args.company_id, approval_type: 'custom', entity_type: 'debt', entity_id: args.debt_id,
    title: `طلب تقسيط من العميل: ${args.customer_name ?? ''}`,
    description,
    status: 'pending', priority: 'medium',
    requested_data: {
      kind: 'installment_request',
      customer_id: args.customer_id,
      customer_message: args.customer_message,
      agent_message: args.agent_message ?? null,
    },
  })

  await supabase.from('system_alerts').insert({
    company_id: args.company_id, severity: 'info', alert_type: 'installment_request',
    title: 'طلب تقسيط يحتاج مراجعة',
    message: `العميل ${args.customer_name ?? ''} طلب تقسيط الدين — يحتاج موافقة الإدارة.`,
    metadata: { debt_id: args.debt_id, customer_id: args.customer_id, customer_message: args.customer_message },
    is_resolved: false,
  })

  try {
    await supabase.from('timeline_events').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      event_type: 'escalation', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: 'طلب تقسيط — رُفع للمراجعة',
      detail: args.customer_message,
      occurred_at: new Date().toISOString(),
    })
  } catch (e) {
    log.error('installment request timeline insert failed', e as Error)
  }
}
