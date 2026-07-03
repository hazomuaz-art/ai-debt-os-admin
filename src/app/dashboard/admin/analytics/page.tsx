import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import AnalyticsCharts from '@/components/dashboard/AnalyticsCharts'
import { BarChart3, Wallet, Target, Activity } from 'lucide-react'
import { getServerTranslation } from '@/lib/i18n/server'

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
      label: d.toLocaleString('ar', { month: 'short', year: '2-digit' }),
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
    { data: allPaymentAmounts },
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
    // Full (unlimited) payments sum — the single source of truth for "total
    // collected" everywhere in this app. Previously this page computed
    // "collected" two different ways from two different sources (this exact
    // payments sum for the monthly trend chart, vs. original-minus-outstanding
    // balance delta for the summary KPI/collection-rate), which silently
    // diverge whenever a balance changes without a matching payment row (a
    // manual write-off/adjustment) or vice versa. Only 'amount' is selected —
    // cheap even at full table scope.
    supabase
      .from('payments')
      .select('amount')
      .eq('company_id', profile.company_id),
  ])

  // Compute summary stats
  const totalDebts = allDebts?.length ?? 0
  const totalOriginal = allDebts?.reduce((s, d) => s + Number(d.original_amount), 0) ?? 0
  const totalOutstanding = allDebts?.reduce((s, d) => s + Number(d.current_balance), 0) ?? 0
  // Authoritative "collected" figure — sum of actual recorded payments,
  // the same source the monthly trend chart already uses. This must be the
  // ONLY number this app calls "total collected" anywhere.
  const totalCollectedAll = allPaymentAmounts?.reduce((s, p) => s + Number(p.amount), 0) ?? 0
  const collectionRate = totalOriginal > 0 ? (totalCollectedAll / totalOriginal) * 100 : 0
  // Balance-delta figure kept ONLY to detect drift between recorded payments
  // and actual outstanding-balance movement (e.g. a manual balance
  // adjustment/write-off with no matching payment row, or a payment write
  // that silently failed to update the balance). A real, visible divergence
  // here is a data-integrity signal, not just a display inconsistency to
  // paper over — surfaced below instead of hidden.
  const balanceDelta = totalOriginal - totalOutstanding
  const reconciliationGap = balanceDelta - totalCollectedAll
  const reconciliationGapPct = totalOriginal > 0 ? (Math.abs(reconciliationGap) / totalOriginal) * 100 : 0
  const hasReconciliationGap = Math.abs(reconciliationGap) > 1 && reconciliationGapPct > 1
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

  const { t, dir } = getServerTranslation()
  const an = t.pages.analytics

  return (
    <div dir={dir} className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >

      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0">
            <BarChart3 size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">{an.title}</h1>
            <p className="text-[#8b95a7] text-sm">{an.subtitle}</p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div className="text-[#8b95a7] text-sm font-bold">{an.total_claims}</div>
            <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center"><BarChart3 size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-white font-mono">{totalDebts.toLocaleString()}</div>
        </div>

        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div className="text-[#8b95a7] text-sm font-bold">{an.total_portfolio}</div>
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center"><Wallet size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-emerald-400 font-mono">{formatCurrency(totalOriginal, 'SAR')}</div>
        </div>

        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div className="text-[#8b95a7] text-sm font-bold">{an.collection_rate}</div>
            <div className="w-10 h-10 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center"><Target size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-purple-400 font-mono">{collectionRate.toFixed(1)}%</div>
        </div>

        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-4">
            <div className="text-[#8b95a7] text-sm font-bold">{an.avg_ai_score}</div>
            <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center"><Activity size={20} /></div>
          </div>
          <div className={`text-3xl font-bold font-mono ${avgScore >= 60 ? 'text-emerald-400' : avgScore >= 40 ? 'text-amber-400' : 'text-rose-400'}`}>
            {avgScore || '—'}
          </div>
        </div>

      </div>

      {/* Data-integrity signal: recorded payments vs. actual balance movement
          disagree by more than a trivial amount — surfaced immediately
          instead of silently showing an inconsistent number elsewhere. */}
      {hasReconciliationGap && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-sm text-amber-300 font-bold">
          تنبيه مطابقة بيانات: الفرق بين إجمالي المدفوعات المسجَّلة وإجمالي انخفاض الأرصدة يبلغ {formatCurrency(Math.abs(reconciliationGap), 'SAR')} ({reconciliationGapPct.toFixed(1)}%) — قد يكون سببه تسوية رصيد يدوية بدون سداد مقابل، أو سداد مسجَّل لم يُحدَّث معه رصيد المديونية.
        </div>
      )}

      {/* Charts — client component with Recharts */}
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
