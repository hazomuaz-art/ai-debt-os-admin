import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import Link from 'next/link'

export default async function CollectorDashboard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, company:companies(name)')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  const today = new Date().toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const [
    { data: assignedDebts, count: totalAssigned },
    { data: payments },
    { data: todayActions },
  ] = await Promise.all([
    supabase.from('debts')
      .select('*, customer:customers(full_name, phone, whatsapp)', { count: 'exact' })
      .eq('assigned_to', user.id)
      .neq('status', 'settled')
      .order('priority', { ascending: false })
      .limit(10),
    supabase.from('payments')
      .select('amount')
      .eq('recorded_by', user.id)
      .gte('payment_date', monthStart),
    supabase.from('ai_actions')
      .select('*, customer:customers(full_name, phone, whatsapp), debt:debts(reference_number, current_balance, currency)')
      .eq('assigned_to', user.id)
      .eq('scheduled_for', today)
      .eq('status', 'pending')
      .order('priority', { ascending: false })
      .limit(5),
  ])

  const totalBalance = (assignedDebts ?? []).reduce((s, d) => s + d.current_balance, 0)
  const collectedMonth = (payments ?? []).reduce((s, p) => s + p.amount, 0)

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  const sortedDebts = (assignedDebts ?? []).sort((a, b) =>
    (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 4) -
    (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 4)
  )

  const actionTypeIcons: Record<string, string> = {
    call: '📞', whatsapp: '💬', email: '✉️', visit: '🚶',
    legal: '⚖️', escalate: '🔺', settle: '✅',
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold">My Queue</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {profile.full_name?.split(' ')[0] ?? 'Collector'} — {new Date().toLocaleDateString('en-SA', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Assigned Debts', value: totalAssigned ?? 0, color: 'text-blue-400' },
          { label: 'Total Balance', value: formatCurrency(totalBalance), color: 'text-slate-900' },
          { label: 'Collected This Month', value: formatCurrency(collectedMonth), color: 'text-green-400' },
          { label: "Today's Actions", value: (todayActions ?? []).length, color: 'text-brand-400' },
        ].map(stat => (
          <div key={stat.label} className="stat-card">
            <div className="text-slate-500 text-xs font-medium uppercase tracking-wider">{stat.label}</div>
            <div className={`font-display text-xl font-bold ${stat.color}`}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Today's AI Actions */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold">Today&apos;s Actions</h2>
            <Link href="/dashboard/collector/actions" className="text-brand-400 text-xs hover:text-brand-300">View all →</Link>
          </div>
          {(todayActions ?? []).length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No actions for today yet</div>
          ) : (todayActions ?? []).map((action: {
            id: string
            action_type: string
            priority: string
            reason: string
            suggested_message?: string
            customer?: { full_name?: string } | null
            debt?: { reference_number?: string; current_balance?: number; currency?: string } | null
          }) => (
            <div key={action.id} className="flex items-start gap-3 p-3 bg-white/2 rounded-lg border border-slate-200 mb-2">
              <span className="text-xl">{actionTypeIcons[action.action_type] ?? '◆'}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{(action.customer as {full_name?: string} | null)?.full_name}</span>
                  <span className={`status-badge text-[10px] ${getStatusColor(action.priority)}`}>{action.priority}</span>
                </div>
                <div className="text-slate-500 text-xs mt-0.5">{action.reason}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Assigned debts */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-semibold">My Top Debts</h2>
            <Link href="/dashboard/collector/debts" className="text-brand-400 text-xs hover:text-brand-300">View all →</Link>
          </div>
          {sortedDebts.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-sm">No debts assigned yet</div>
          ) : sortedDebts.slice(0, 5).map((debt: {
            id: string
            reference_number: string
            current_balance: number
            currency: string
            status: string
            priority: string
            due_date?: string
            customer?: { full_name?: string; phone?: string } | null
          }) => (
            <div key={debt.id} className="flex items-center justify-between p-3 bg-white/2 rounded-lg border border-slate-200 mb-2 hover:border-slate-200 transition-colors">
              <div>
                <div className="text-sm font-medium">{(debt.customer as {full_name?: string} | null)?.full_name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-xs text-brand-400/70">{debt.reference_number}</span>
                  <span className={`status-badge text-[10px] ${getStatusColor(debt.status)}`}>{debt.status}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold">{formatCurrency(debt.current_balance, debt.currency)}</div>
                <span className={`text-xs ${getStatusColor(debt.priority)} status-badge`}>{debt.priority}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
