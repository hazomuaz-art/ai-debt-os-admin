import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('dispute')

// Must match the `disputes.dispute_type` CHECK constraint exactly.
type DisputeType = 'amount_wrong' | 'already_paid' | 'not_my_debt' | 'service_issue' | 'other'

function classifyDisputeType(text: string): DisputeType {
  const t = text.toLowerCase()
  if (/سددت|دفعت|حولت|ايصال|إيصال|paid|receipt/.test(t)) return 'already_paid'
  if (/مو صحيح|غلط|مبلغ غلط|زياده|زيادة|wrong amount/.test(t)) return 'amount_wrong'
  if (/ما اعرف|ما أعرف|مو لي|مو دينه|مو ديني|not mine|مين انت|رقم غلط|wrong number/.test(t)) return 'not_my_debt'
  if (/خدمة|منتج|سوء|تقصير|service/.test(t)) return 'service_issue'
  return 'other'
}

/**
 * Records a customer dispute with full context — the customer's exact
 * wording, the agent's reasoning for escalating, and a short excerpt of the
 * surrounding conversation — instead of a single bare line. Also opens the
 * matching admin approval. Deduplicates against an existing open dispute.
 *
 * Usable from any WhatsApp gateway webhook (WAHA).
 */
export async function recordDispute(args: {
  company_id: string
  customer_id: string
  customer_name?: string | null
  debt_id: string
  customer_message: string
  agent_reason?: string
}): Promise<void> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('disputes')
    .select('id')
    .eq('company_id', args.company_id)
    .eq('debt_id', args.debt_id)
    .in('status', ['open', 'under_review'])
    .limit(1).maybeSingle()
  if (existing) {
    log.info('dispute already open for this debt — skipping duplicate', { debt_id: args.debt_id })
    return
  }

  // Last few turns for context, so an admin reviewing the dispute doesn't
  // have to dig through the full chat history to understand it.
  const { data: history } = await supabase
    .from('messages')
    .select('direction, content, created_at')
    .eq('customer_id', args.customer_id)
    .order('created_at', { ascending: false })
    .limit(6)
  const excerpt = (history ?? [])
    .reverse()
    .map((m: { direction: string; content: string }) => `${m.direction === 'inbound' ? 'العميل' : 'الوكيل'}: ${m.content}`)
    .join('\n')

  const dispute_type = classifyDisputeType(args.customer_message)

  const description = [
    `كلام العميل: "${args.customer_message}"`,
    args.agent_reason ? `تقييم الوكيل: ${args.agent_reason}` : null,
  ].filter(Boolean).join('\n')

  const { data: disp, error } = await supabase.from('disputes').insert({
    company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
    dispute_type, description, status: 'open', priority: 'high', source: 'ai',
    metadata: {
      customer_message: args.customer_message,
      agent_reason: args.agent_reason ?? null,
      conversation_excerpt: excerpt,
    },
  }).select('id').single()

  if (error) { log.error('failed to insert dispute', error); return }

  await supabase.from('approvals').insert({
    company_id: args.company_id, approval_type: 'dispute', entity_type: 'debt', entity_id: args.debt_id,
    title: `اعتراض عميل: ${args.customer_name ?? ''}`,
    description: [
      `كلام العميل: "${args.customer_message}"`,
      args.agent_reason ? `تقييم الوكيل: ${args.agent_reason}` : null,
      excerpt ? `\nآخر المحادثة:\n${excerpt}` : null,
    ].filter(Boolean).join('\n'),
    status: 'pending', priority: 'high',
    requested_data: {
      customer_id: args.customer_id, dispute_id: disp?.id ?? null,
      reason: args.customer_message, agent_reason: args.agent_reason ?? null,
      dispute_type, conversation_excerpt: excerpt,
    },
  })
}
