import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { Activity } from 'lucide-react'

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  created: { label: 'Created', color: 'text-green-400' },
  status_updated: { label: 'Status Changed', color: 'text-blue-400' },
  payment_recorded: { label: 'Payment', color: 'text-emerald-400' },
  assigned: { label: 'Assigned', color: 'text-purple-400' },
  scored: { label: 'AI Scored', color: 'text-brand-400' },
  message_sent: { label: 'Message Sent', color: 'text-cyan-400' },
  deleted: { label: 'Deleted', color: 'text-red-400' },
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: { entity?: string; page?: string }
}) {
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

  const page = parseInt(searchParams.page ?? '1')
  const limit = 50
  const offset = (page - 1) * limit

  let query = supabase
    .from('logs')
    .select(`
      *,
      user:profiles!logs_user_id_fkey(full_name, email)
    `, { count: 'exact' })
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (searchParams.entity) {
    query = query.eq('entity_type', searchParams.entity)
  }

  const { data: logs, count } = await query
  const totalPages = Math.ceil((count ?? 0) / limit)

  const entityTypes = ['debt', 'payment', 'customer', 'message', 'user']

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-syne">Activity Log</h1>
        <p className="text-slate-400">All system actions for your company</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        <a
          href="/dashboard/admin/activity"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            !searchParams.entity
              ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
              : 'bg-surface-100 text-slate-400 border-surface-200 hover:text-white'
          }`}
        >
          All
        </a>
        {entityTypes.map(et => (
          <a
            key={et}
            href={`/dashboard/admin/activity?entity=${et}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${
              searchParams.entity === et
                ? 'bg-brand-600/20 text-brand-400 border-brand-600/30'
                : 'bg-surface-100 text-slate-400 border-surface-200 hover:text-white'
            }`}
          >
            {et}
          </a>
        ))}
      </div>

      <div className="card">
        {logs && logs.length > 0 ? (
          <div className="divide-y divide-surface-100">
            {logs.map((log: any) => {
              const actionMeta = ACTION_LABELS[log.action] ?? { label: log.action, color: 'text-slate-400' }
              return (
                <div key={log.id} className="py-3 flex items-start gap-4">
                  <div className="w-2 h-2 rounded-full bg-surface-300 mt-2 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold uppercase tracking-wide ${actionMeta.color}`}>
                        {actionMeta.label}
                      </span>
                      <span className="text-slate-500 text-xs capitalize">{log.entity_type}</span>
                      {log.entity_id && (
                        <span className="text-slate-600 text-xs font-mono truncate max-w-[140px]">
                          {log.entity_id.slice(0, 8)}…
                        </span>
                      )}
                    </div>
                    {log.new_values && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {Object.entries(log.new_values)
                          .slice(0, 3)
                          .map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`)
                          .join(' · ')}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-1">
                      {(log.user as any)?.full_name || (log.user as any)?.email || 'System'}
                      {' · '}
                      {formatDate(log.created_at)}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <Activity className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No activity yet</p>
          </div>
        )}

        {totalPages > 1 && (
          <div className="pt-4 border-t border-surface-100 flex items-center justify-between">
            <span className="text-slate-400 text-sm">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <a href={`/dashboard/admin/activity?page=${page - 1}${searchParams.entity ? `&entity=${searchParams.entity}` : ''}`}
                  className="btn-secondary text-xs py-1.5 px-3">Previous</a>
              )}
              {page < totalPages && (
                <a href={`/dashboard/admin/activity?page=${page + 1}${searchParams.entity ? `&entity=${searchParams.entity}` : ''}`}
                  className="btn-secondary text-xs py-1.5 px-3">Next</a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
