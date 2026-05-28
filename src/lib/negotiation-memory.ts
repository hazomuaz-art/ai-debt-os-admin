import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function buildNegotiationMemory(params: {
  company_id: string
  customer_id: string
}) {
  const [{ data: memory }, { data: timeline }] = await Promise.all([
    supabase
      .from('ai_memory')
      .select('*')
      .eq('company_id', params.company_id)
      .eq('customer_id', params.customer_id)
      .order('updated_at', { ascending: false })
      .limit(10),

    supabase
      .from('timeline_events')
      .select('*')
      .eq('company_id', params.company_id)
      .eq('customer_id', params.customer_id)
      .order('occurred_at', { ascending: false })
      .limit(20),
  ])

  const lastObjection = timeline?.find((e) =>
    String(e.event_type).includes('objection') ||
    String(e.title ?? '').toLowerCase().includes('objection') ||
    String(e.description ?? '').includes('اعتراض')
  )

  const lastPromise = timeline?.find((e) =>
    String(e.event_type).includes('promise') ||
    String(e.title ?? '').toLowerCase().includes('promise') ||
    String(e.description ?? '').includes('وعد')
  )

  return {
    memory: memory ?? [],
    recent_events: timeline ?? [],
    last_objection: lastObjection ?? null,
    last_promise: lastPromise ?? null,
    negotiation_context: {
      has_memory: (memory?.length ?? 0) > 0,
      recent_events_count: timeline?.length ?? 0,
      has_recent_objection: !!lastObjection,
      has_recent_promise: !!lastPromise,
    },
  }
}
