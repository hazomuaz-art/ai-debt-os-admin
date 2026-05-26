import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import Link from 'next/link'

async function getAdminStats(companyId: string) {
  const supabase = createClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const today = now.toISOString().split('T')[0]

  const [
    { count: totalDebts },
    { data: balanceData },
    { data: collectedData },
    { count: activeCustomers },
    { count: overdueDebts },
    { count: aiActionsToday },
    { count: messagesToday },
    { data: recentDebts },
    { data: topCollectors },
    { data: statusBreakdown },
  ] = await Promise.all([
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('debts').select('current_balance').eq('company_id', companyId).neq('status', 'settled'),
    supabase.from('payments').select('amount').eq('company_id', companyId).gte('payment_date', monthStart),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', companyId).lt('due_date', today).not('status', 'in', '("settled","written_off")'),
    supabase.from('ai_actions').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('scheduled_for', today),
    supabase.from('messages').select('*', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', `${today}T00:00:00`),
    supabase.from('debts').select('*, customer:customers(full_name), assigned_collector:profiles!debts_assigned_to_fkey(full_name)').eq('company_id', companyId).order('created_at', { ascending: false }).limit(5),
    supabase.from('debts').select('assigned_to, current_balance, status, profiles!debts_assigned_to_fkey(full_name)').eq('company_id', companyId).not('assigned_to', 'is', null).limit(100),
    supabase.from('debts').select('status').eq('company_id', companyId),
  ])

  const totalBalance = balanceData?.reduce((sum, d) => sum + (d.current_balance ?? 0), 0) ?? 0
  const totalCollected = collectedData?.reduce((sum, p) => sum + (p.amount ?? 0), 0) ?? 0
  const collectionRate = totalBalance > 0 ? (totalCollected / (totalBalance + totalCollected) * 100) : 0

  // Status breakdown
  const statusCount: Record<string, number> = {}
  for (const debt of statusBreakdown ?? []) {
    statusCount[debt.status] = (statusCount[debt.status] ?? 0) + 1
  }

  return {
    totalDebts: totalDebts ?? 0,
    totalBalance,
    totalCollected,
    collectionRate,
    activeCustomers: activeCustomers ?? 0,
    overdueDebts: overdueDebts ?? 0,
    aiActionsToday: aiActionsToday ?? 0,
    messagesToday: messagesToday ?? 0,
    recentDebts: recentDebts ?? [],
    statusBreakdown: statusCount,
  }
}

export default async function AdminDashboard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, full_name, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/collector')

  const stats = await getAdminStats(profile.company_id)

  const statCards = [
    { label: 'Total Portfolio', value: formatCurrency(stats.totalBalance), sub: `${stats.totalDebts} debts`, color: 'text-blue-400', icon: '◈' },
    { label: 'Collected This Month', value: formatCurrency(stats.totalCollected), sub: `${stats.collectionRate.toFixed(1)}% collection rate`, color: 'text-green-400', icon: '◉' },
    { label: 'Overdue Debts', value: stats.overdueDebts.toString(), sub: 'Past due date', color: 'text-red-400', icon: '⚠' },
    { label: 'AI Actions Today', value: stats.aiActionsToday.toString(), sub: `${stats.messagesToday} messages sent`, color: 'text-brand-400', icon: '◆' },
  ]

  const statusLabels: Record<string, string> = {
    active: 'Active', in_progress: 'In Progress', promised: 'Promised',
    partial: 'Partial', settled: 'Settled', written_off: 'Written Off',
    legal: 'Legal', disputed: 'Disputed',
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Welcome back, {profile.full_name?.split(' ')[0] ?? 'Admin'} — {new Date().toLocaleDateString('en-SA', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/dashboard/admin/debts" className="btn-secondary text-sm">View All Debts</Link>
          <Link href="/dashboard/admin/ai-actions" className="btn-primary text-sm">AI Actions</Link>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map(stat => (
          <div key={stat.label} className="stat-card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/40 text-xs font-medium uppercase tracking-wider">{stat.label}</span>
              <span className={`text-lg ${stat.color}`}>{stat.icon}</span>
            </div>
            <div className={`font-display text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-white/30 text-xs">{stat.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Recent Debts */}
        <div className="xl:col-span-2 card p-5">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-display font-semibold">Recent Debts</h2>
            <Link href="/dashboard/admin/debts" className="text-brand-400 text-xs hover:text-brand-300">View all →</Link>
          </div>
          <div className="space-y-3">
            {stats.recentDebts.length === 0 ? (
              <div className="text-center py-8 text-white/30">
                <div className="text-3xl mb-2">◈</div>
                <div className="text-sm">No debts yet. <Link href="/dashboard/admin/debts" className="text-brand-400 hover:underline">Add the first one</Link></div>
              </div>
            ) : stats.recentDebts.map((debt: {
              id: string
              reference_number: string
              current_balance: number
              currency: string
              status: string
              created_at: string
              customer?: { full_name?: string } | null
              assigned_collector?: { full_name?: string } | null
            }) => (
              <div key={debt.id} className="flex items-center justify-between p-3 bg-white/2 rounded-lg border border-white/5 hover:border-white/10 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-brand-800/50 rounded-lg flex items-center justify-center text-xs font-mono text-brand-400">
                    {debt.reference_number.slice(-3)}
                  </div>
                  <div>
                    <div className="text-sm font-medium">{(debt.customer as {full_name?: string} | null)?.full_name ?? 'Unknown'}</div>
                    <div className="text-white/30 text-xs">{formatDate(debt.created_at)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium">{formatCurrency(debt.current_balance, debt.currency)}</div>
                  <span className={`status-badge text-[10px] ${getStatusColor(debt.status)}`}>
                    {statusLabels[debt.status] ?? debt.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="card p-5">
          <h2 className="font-display font-semibold mb-5">Portfolio Status</h2>
          <div className="space-y-2">
            {Object.entries(stats.statusBreakdown).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between p-2.5 bg-white/2 rounded-lg">
                <span className={`status-badge text-[11px] ${getStatusColor(status)}`}>
                  {statusLabels[status] ?? status}
                </span>
                <span className="font-mono text-sm font-semibold">{count}</span>
              </div>
            ))}
            {Object.keys(stats.statusBreakdown).length === 0 && (
              <div className="text-center py-6 text-white/30 text-sm">No data yet</div>
            )}
          </div>

          <div className="mt-5 pt-4 border-t border-white/5">
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Total Customers</span>
              <span className="font-semibold">{stats.activeCustomers}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
