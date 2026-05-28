import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import AnalyticsCharts from '@/components/dashboard/AnalyticsCharts'
import { calculateExecutiveMetrics } from '@/lib/executive-metrics'
import { generateExecutiveInsights } from '@/lib/executive-insights'

export default async function AnalyticsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) redirect('/login')

  // Last 6 months
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - (5 - i))
    return {
      label: d.toLocaleString('en', { month: 'short', year: '2-digit' }),
      start: new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0],
      end: new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0],
    }
  })

  const monthlyData = await Promise.all(months.map(async m => {
    const [{ data: payments }, { count: newDebts }] = await Promise.all([
      supabase
        .from('payments')
        .select('amount')
        .eq('company_id', profile.company_id)
        .gte('payment_date', m.start)
        .lte('payment_date', m.end),
      supabase
        .from('debts')
        .select('*', { count: 'exact', head: true })
        .eq('company_id', profile.company_id)
        .gte('created_at', m.start)
        .lte('created_at', m.end),
    ])
    return {
      month: m.label,
      collected: payments?.reduce((s, p) => s + Number(p.amount), 0) ?? 0,
      newDebts: newDebts ?? 0,
    }
  }))

  const [
    { data: aiScores },
    { data: allDebts },
    { data: allMessages },
    { data: allPayments },
  ] = await Promise.all([
    supabase
      .from('ai_scores')
      .select('score, risk_classification, created_at')
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('debts')
      .select('status, priority, original_amount, current_balance, currency')
      .eq('company_id', profile.company_id),
    supabase
      .from('messages')
      .select('channel, direction, created_at')
      .eq('company_id', profile.company_id),
    supabase
      .from('payments')
      .select('amount, payment_date, currency')
      .eq('company_id', profile.company_id)
      .order('payment_date', { ascending: false })
      .limit(500),
  ])

  // Compute summary stats
  const totalDebts = allDebts?.length ?? 0
  const totalOriginal = allDebts?.reduce((s, d) => s + Number(d.original_amount), 0) ?? 0
  const totalOutstanding = allDebts?.reduce((s, d) => s + Number(d.current_balance), 0) ?? 0
  const totalCollectedAll = totalOriginal - totalOutstanding
  const collectionRate = totalOriginal > 0 ? (totalCollectedAll / totalOriginal) * 100 : 0
  const avgScore = aiScores?.length
    ? Math.round(aiScores.reduce((s, a) => s + a.score, 0) / aiScores.length)
    : 0

  const statusCounts: Record<string, number> = {}
  for (const d of allDebts ?? []) {
    statusCounts[d.status] = (statusCounts[d.status] ?? 0) + 1
  }

  const priorityCounts: Record<string, number> = {}
  for (const d of allDebts ?? []) {
    priorityCounts[d.priority] = (priorityCounts[d.priority] ?? 0) + 1
  }

  const channelCounts: Record<string, number> = {}
  for (const m of allMessages ?? []) {
    channelCounts[m.channel] = (channelCounts[m.channel] ?? 0) + 1
  }

  const riskCounts: Record<string, number> = {}
  for (const s of aiScores ?? []) {
    if (s.risk_classification) {
      riskCounts[s.risk_classification] = (riskCounts[s.risk_classification] ?? 0) + 1
    }
  }

  // Build chart-ready arrays
  const statusChartData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }))
  const channelChartData = Object.entries(channelCounts).map(([name, value]) => ({ name, value }))
  const priorityChartData = Object.entries(priorityCounts).map(([name, value]) => ({ name, value }))
  const riskChartData = Object.entries(riskCounts).map(([name, value]) => ({ name, value }))

  const executiveMetrics = calculateExecutiveMetrics({
    total_debts: totalDebts,
    recovered_debts: statusCounts.paid ?? 0,
    total_amount: totalOriginal,
    recovered_amount: totalCollectedAll,
    high_risk_cases: riskCounts.high ?? riskCounts.high_risk ?? 0
  })

  const executiveInsights = generateExecutiveInsights({
    collection_rate: executiveMetrics.collection_rate,
    ai_recovery_rate: executiveMetrics.ai_recovery_rate,
    high_risk_cases: executiveMetrics.high_risk_cases
  })

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-syne">Analytics</h1>
        <p className="text-slate-400">Portfolio performance and collection intelligence</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-slate-400 text-sm">Total Debts</p>
          <p className="text-2xl font-bold font-syne">{totalDebts.toLocaleString()}</p>
        </div>
        <div className="stat-card">
          <p className="text-slate-400 text-sm">Total Portfolio</p>
          <p className="text-2xl font-bold font-syne">{formatCurrency(totalOriginal, 'SAR')}</p>
        </div>
        <div className="stat-card">
          <p className="text-slate-400 text-sm">Collection Rate</p>
          <p className="text-2xl font-bold font-syne text-brand-400">{collectionRate.toFixed(1)}%</p>
        </div>
        <div className="stat-card">
          <p className="text-slate-400 text-sm">Avg AI Score</p>
          <p className={`text-2xl font-bold font-syne ${avgScore >= 60 ? 'text-green-400' : avgScore >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
            {avgScore || 'â€”'}
          </p>
        </div>
      </div>

      {/* Executive AI Dashboard */}
      <div className="card border border-cyan-500/20 bg-cyan-500/5">
        <h2 className="text-lg font-semibold font-syne mb-4">
          Executive AI Dashboard
        </h2>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
          <div className="stat-card">
            <p className="text-slate-400 text-sm">AI Recovery Rate</p>
            <p className="text-2xl font-bold font-syne text-cyan-400">
              {executiveMetrics.ai_recovery_rate}%
            </p>
          </div>

          <div className="stat-card">
            <p className="text-slate-400 text-sm">Active Cases</p>
            <p className="text-2xl font-bold font-syne">
              {executiveMetrics.active_cases.toLocaleString()}
            </p>
          </div>

          <div className="stat-card">
            <p className="text-slate-400 text-sm">Recovered Amount</p>
            <p className="text-2xl font-bold font-syne text-green-400">
              {formatCurrency(executiveMetrics.recovered_amount, 'SAR')}
            </p>
          </div>

          <div className="stat-card">
            <p className="text-slate-400 text-sm">High Risk Cases</p>
            <p className="text-2xl font-bold font-syne text-red-400">
              {executiveMetrics.high_risk_cases.toLocaleString()}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-slate-400 text-sm">Executive Insights</p>
          {executiveInsights.map((insight: string, index: number) => (
            <div
              key={index}
              className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white"
            >
              {insight}
            </div>
          ))}
        </div>
      </div>

      {/* Charts â€” client component with Recharts */}
      <AnalyticsCharts
        monthlyData={monthlyData}
        statusChartData={statusChartData}
        channelChartData={channelChartData}
        priorityChartData={priorityChartData}
        riskChartData={riskChartData}
      />
    </div>
  )
}



