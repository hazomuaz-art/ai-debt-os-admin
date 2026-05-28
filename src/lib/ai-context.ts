import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function buildCustomerContext(params: {
  company_id: string
  customer_id: string
}) {
  const { data: timeline } = await supabase
    .from('timeline_events')
    .select('*')
    .eq('company_id', params.company_id)
    .eq('customer_id', params.customer_id)
    .order('occurred_at', { ascending: false })
    .limit(25)

  const lastPayment = timeline?.find((e) => e.event_type === 'payment')
  const lastPromise = timeline?.find((e) => e.event_type === 'promise')
  const lastWhatsapp = timeline?.find((e) => e.event_type === 'whatsapp')
  const lastCall = timeline?.find((e) => e.event_type === 'call')

  const engagementScore =
    (lastWhatsapp ? 25 : 0) +
    (lastCall ? 25 : 0) +
    (lastPromise ? 25 : 0) +
    (lastPayment ? 25 : 0)

  return {
    engagement_score: engagementScore,
    customer_status:
      engagementScore >= 75 ? 'highly_engaged' :
      engagementScore >= 50 ? 'engaged' :
      engagementScore >= 25 ? 'responsive' :
      'cold',

    last_payment: lastPayment ?? null,
    last_promise: lastPromise ?? null,
    last_whatsapp: lastWhatsapp ?? null,
    last_call: lastCall ?? null,

    recent_events: timeline ?? []
  }
}
