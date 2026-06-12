import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { Activity } from 'lucide-react'

export default async function ActivityPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) redirect('/login')
  if (profile.role !== 'admin') redirect('/dashboard')

  const { data: events } = await supabase
    .from('timeline_events')
    .select('id, event_type, title, description, source, occurred_at, customer_id, debt_id, metadata')
    .eq('company_id', profile.company_id)
    .order('occurred_at', { ascending: false })
    .limit(100)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-syne">Activity Log</h1>
        <p className="text-slate-400">Automation and timeline events for your company</p>
      </div>

      <div className="card">
        {events && events.length > 0 ? (
          <div className="divide-y divide-surface-100">
            {events.map((event: any) => (
              <div key={event.id} className="py-3 flex items-start gap-4">
                <div className="w-2 h-2 rounded-full bg-brand-400 mt-2 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-400">
                      {event.event_type}
                    </span>
                    {event.source && (
                      <span className="text-slate-500 text-xs">
                        {event.source}
                      </span>
                    )}
                    {event.debt_id && (
                      <span className="text-slate-600 text-xs font-mono truncate max-w-[140px]">
                        {String(event.debt_id).slice(0, 8)}…
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-slate-900 mt-1">
                    {event.title || 'System activity'}
                  </p>

                  {event.description && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {event.description}
                    </p>
                  )}

                  <p className="text-xs text-slate-500 mt-1">
                    {formatDate(event.occurred_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Activity className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No activity yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
