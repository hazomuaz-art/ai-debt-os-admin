import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function createTimelineEvent(data: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  event_type: string
  title: string
  description?: string | null
  metadata?: Record<string, unknown>
}) {
  try {
    await supabase
      .from('timeline_events')
      .insert({
        company_id: data.company_id,
        customer_id: data.customer_id,
        debt_id: data.debt_id ?? null,
        event_type: data.event_type,
        title: data.title,
        description: data.description ?? null,
        metadata: data.metadata ?? {},
        occurred_at: new Date().toISOString()
      })
  } catch (error) {
    console.error('[timeline-event]', error)
  }
}
