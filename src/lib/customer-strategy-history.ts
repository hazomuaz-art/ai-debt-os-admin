import { createServiceClient } from '@/lib/supabase/server'

export type StrategyHistory = {
  // The reason/action of the outbound message that preceded a promise this
  // customer actually KEPT (or paid against, or is still pending) — proven
  // to work for THIS customer specifically.
  effectiveActions: string[]
  // The reason/action that preceded a promise this customer BROKE — proven
  // NOT to work for THIS customer.
  ineffectiveActions: string[]
  // Dispute types this customer has actually raised before.
  pastObjectionTypes: string[]
}

const LOOKBACK_WINDOW_MS = 60 * 60 * 1000 // 1 hour before the promise was created

/**
 * Analyzes THIS customer's own real history — which agent action/reason
 * preceded a promise they actually kept vs broke, and what objections
 * they've raised before. Returns null when there isn't enough history yet
 * (fewer than one resolved promise) — never fabricates a pattern from
 * insufficient data.
 */
export async function analyzeCustomerStrategyHistory(
  company_id: string,
  customer_id: string,
): Promise<StrategyHistory | null> {
  const svc = createServiceClient()

  const { data: promises } = await svc
    .from('promises')
    .select('status, created_at')
    .eq('company_id', company_id)
    .eq('customer_id', customer_id)
    .in('status', ['kept', 'broken', 'partial'])
    .order('created_at', { ascending: false })
    .limit(20)

  const resolved = promises ?? []
  if (resolved.length === 0) return null

  const { data: outboundMessages } = await svc
    .from('messages')
    .select('content, sent_at, metadata')
    .eq('company_id', company_id)
    .eq('customer_id', customer_id)
    .eq('direction', 'outbound')
    .order('sent_at', { ascending: false })
    .limit(200)

  const outbound = (outboundMessages ?? []) as Array<{ sent_at: string; metadata: any }>

  function findPrecedingAction(promiseCreatedAt: string): string | null {
    const promiseTime = new Date(promiseCreatedAt).getTime()
    let best: { sent_at: number; action: string } | null = null
    for (const m of outbound) {
      const sentAt = new Date(m.sent_at).getTime()
      if (sentAt > promiseTime) continue
      if (promiseTime - sentAt > LOOKBACK_WINDOW_MS) continue
      const action = m.metadata?.action_type ?? null
      if (!action) continue
      if (!best || sentAt > best.sent_at) best = { sent_at: sentAt, action }
    }
    return best?.action ?? null
  }

  const effective = new Set<string>()
  const ineffective = new Set<string>()
  for (const p of resolved) {
    const action = findPrecedingAction(p.created_at)
    if (!action) continue
    if (p.status === 'kept') effective.add(action)
    else if (p.status === 'broken') ineffective.add(action)
  }

  const { data: disputes } = await svc
    .from('disputes')
    .select('dispute_type')
    .eq('company_id', company_id)
    .eq('customer_id', customer_id)
    .limit(20)

  const objectionTypes: string[] = Array.from(new Set((disputes ?? []).map((d: any) => String(d.dispute_type)).filter(Boolean)))

  if (effective.size === 0 && ineffective.size === 0 && objectionTypes.length === 0) return null

  return {
    effectiveActions: Array.from(effective),
    ineffectiveActions: Array.from(ineffective),
    pastObjectionTypes: objectionTypes,
  }
}
