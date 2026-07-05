import { createServiceClient } from '@/lib/supabase/server'
import { recordAttribution } from '@/lib/revenue-attribution'
import { insertApproval } from '@/lib/approvals'
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

  // Real production bug this fixes: a dispute created before request_subtype
  // existed (or otherwise decided through some other path) had its approval
  // resolved, but the disputes.status sync in the approvals PATCH handler
  // only matches requested_data.request_subtype='dispute' — an approval
  // shaped any other way never touches this row. The dispute stayed "open"
  // forever, and THIS dedup check then silently swallowed every subsequent
  // real dispute the customer raised for that debt, with nothing ever shown
  // to an admin again (confirmed live: a customer's fresh, explicit dispute
  // statement produced zero approval because of a week-old orphaned "open"
  // dispute with no pending decision behind it). Only treat it as a genuine
  // duplicate when there's an ACTUAL pending approval attached — an "open"
  // dispute with no pending decision needs to be resurfaced, not silently
  // re-swallowed forever.
  if (existing) {
    const { data: pendingApproval } = await supabase
      .from('approvals')
      .select('id')
      .eq('company_id', args.company_id)
      .eq('entity_id', args.debt_id)
      .eq('status', 'pending')
      .contains('requested_data', { request_subtype: 'dispute' })
      .limit(1).maybeSingle()
    if (pendingApproval) {
      log.info('dispute already open with a pending approval — skipping duplicate', { debt_id: args.debt_id })
      return
    }
    log.warn('open dispute with no pending approval found (orphaned/stale) — resurfacing instead of silently skipping', { debt_id: args.debt_id, dispute_id: existing.id })
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

  // Reuse the orphaned row instead of inserting a second disputes record for
  // the same debt when one was found above with no pending approval behind it.
  const disputeFields = {
    dispute_type, description, priority: 'high' as const,
    metadata: {
      customer_message: args.customer_message,
      agent_reason: args.agent_reason ?? null,
      conversation_excerpt: excerpt,
    },
  }
  const { data: disp, error } = existing
    ? await supabase.from('disputes').update(disputeFields).eq('id', existing.id).select('id').single()
    : await supabase.from('disputes').insert({
        company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
        status: 'open', source: 'ai', ...disputeFields,
      }).select('id').single()

  if (error) { log.error('failed to insert/update dispute', error); return }

  // Routed through insertApproval() (src/lib/approvals.ts) — approval_type
  // is typed against the real CHECK constraint, so 'dispute' (the invalid
  // value this used to pass, silently failing every time) can never be
  // reintroduced by accident again.
  await insertApproval({
    company_id: args.company_id, approval_type: 'custom', entity_type: 'debt', entity_id: args.debt_id,
    title: `اعتراض عميل: ${args.customer_name ?? ''}`,
    description: [
      `كلام العميل: "${args.customer_message}"`,
      args.agent_reason ? `تقييم الوكيل: ${args.agent_reason}` : null,
      excerpt ? `\nآخر المحادثة:\n${excerpt}` : null,
    ].filter(Boolean).join('\n'),
    priority: 'high',
    requested_data: {
      request_subtype: 'dispute',
      customer_id: args.customer_id, dispute_id: disp?.id ?? null,
      reason: args.customer_message, agent_reason: args.agent_reason ?? null,
      dispute_type, conversation_excerpt: excerpt,
    },
  })

  // Attribution: the AI opened this dispute/escalation. `amount` here is
  // contextual (the outstanding balance at the time), never collected
  // revenue — getChannelSummary/getAIvsHumanSummary exclude this event_type.
  if (disp?.id) {
    const { data: debtRow } = await supabase.from('debts').select('current_balance').eq('id', args.debt_id).maybeSingle()
    await recordAttribution({
      company_id: args.company_id,
      event_type: 'dispute',
      source_id: disp.id,
      customer_id: args.customer_id,
      debt_id: args.debt_id,
      amount: Number(debtRow?.current_balance ?? 0),
      primary_channel: 'whatsapp',
      primary_actor: 'ai',
      ai_assisted: true,
    })
  }
}
