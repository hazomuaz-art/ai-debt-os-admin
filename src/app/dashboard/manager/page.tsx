import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'

export default async function ManagerDashboard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role, full_name')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || !['admin', 'manager'].includes(profile.role)) redirect('/dashboard/collector')

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const today = new Date().toISOString().split('T')[0]

  const { data: collectors } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('company_id', profile.company_id)
    .eq('role', 'collector')

  const collectorStats = await Promise.all((collectors ?? []).map(async col => {
    const [
      { count: assigned },
      { data: payments },
      { count: actionsToday },
    ] = await Promise.all([
      supabase.from('debts').select('*', { count: 'exact', head: true }).eq('assigned_to', col.id).neq('status', 'settled'),
      supabase.from('payments').select('amount').eq('recorded_by', col.id).gte('payment_date', monthStart),
      supabase.from('ai_actions').select('*', { count: 'exact', head: true }).eq('assigned_to', col.id).eq('scheduled_for', today).eq('status', 'completed'),
    ])
    return {
      ...col,
      assigned: assigned ?? 0,
      collected: payments?.reduce((s, p) => s + p.amount, 0) ?? 0,
      actionsToday: actionsToday ?? 0,
    }
  }))

  const [
    { count: totalDebts },
    { data: balances },
    { data: monthPayments },
  ] = await Promise.all([
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', profile.company_id),
    supabase.from('debts').select('current_balance').eq('company_id', profile.company_id).neq('status', 'settled'),
    supabase.from('payments').select('amount').eq('company_id', profile.company_id).gte('payment_date', monthStart),
  ])

  const totalBalance = (balances ?? []).reduce((s, d) => s + d.current_balance, 0)
  const totalCollected = (monthPayments ?? []).reduce((s, p) => s + p.amount, 0)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Manager Dashboard</h1>
        <p className="text-white/40 text-sm">Team performance overview</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="text-white/40 text-xs uppercase tracking-wider">Total Portfolio</div>
          <div className="font-display text-2xl font-bold">{formatCurrency(totalBalance)}</div>
          <div className="text-white/30 text-xs">{totalDebts} debts</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs uppercase tracking-wider">Collected This Month</div>
          <div className="font-display text-2xl font-bold text-green-400">{formatCurrency(totalCollected)}</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs uppercase tracking-wider">Active Collectors</div>
          <div className="font-display text-2xl font-bold text-brand-400">{collectors?.length ?? 0}</div>
        </div>
      </div>

      {/* Collector performance */}
      <div className="card p-5">
        <h2 className="font-display font-semibold mb-4">Collector Performance</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="table-header px-4 py-3 text-left">Collector</th>
                <th className="table-header px-4 py-3 text-right">Assigned</th>
                <th className="table-header px-4 py-3 text-right">Collected (Month)</th>
                <th className="table-header px-4 py-3 text-right">Actions Today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {collectorStats.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-white/30">No collectors yet</td></tr>
              ) : collectorStats.sort((a, b) => b.collected - a.collected).map(col => (
                <tr key={col.id} className="hover:bg-white/2">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 bg-brand-800/50 rounded-full flex items-center justify-center text-xs font-semibold text-brand-400">
                        {col.full_name?.charAt(0) ?? '?'}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{col.full_name ?? 'Unnamed'}</div>
                        <div className="text-white/30 text-xs">{col.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">{col.assigned}</td>
                  <td className="px-4 py-3 text-right text-green-400 font-semibold">{formatCurrency(col.collected)}</td>
                  <td className="px-4 py-3 text-right text-brand-400 font-mono">{col.actionsToday}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
