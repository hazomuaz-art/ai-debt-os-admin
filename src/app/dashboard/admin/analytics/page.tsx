import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import AnalyticsCharts from '@/components/dashboard/AnalyticsCharts'
import { BarChart3, Wallet, Target, Activity } from 'lucide-react'

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

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#e7f6ef] font-sans text-slate-800" >
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#f6f8fa] text-[#0e7a54] rounded-xl flex items-center justify-center shrink-0">
            <BarChart3 size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#0e7a54] mb-1">التحليلات والمؤشرات (Analytics)</h1>
            <p className="text-slate-500 text-sm">أداء المحفظة الاستثمارية وذكاء التحصيل المالي</p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <div className="text-slate-500 text-sm font-bold">إجمالي المطالبات</div>
            <div className="w-10 h-10 rounded-full bg-blue-50 text-blue-500 flex items-center justify-center"><BarChart3 size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-[#0e7a54] font-mono">{totalDebts.toLocaleString()}</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <div className="text-slate-500 text-sm font-bold">إجمالي المحفظة</div>
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center"><Wallet size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-emerald-600 font-mono">{formatCurrency(totalOriginal, 'SAR')}</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <div className="text-slate-500 text-sm font-bold">معدل التحصيل العام</div>
            <div className="w-10 h-10 rounded-full bg-purple-50 text-purple-500 flex items-center justify-center"><Target size={20} /></div>
          </div>
          <div className="text-3xl font-bold text-purple-600 font-mono">{collectionRate.toFixed(1)}%</div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <div className="text-slate-500 text-sm font-bold">متوسط تقييم الذكاء الاصطناعي</div>
            <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-500 flex items-center justify-center"><Activity size={20} /></div>
          </div>
          <div className={`text-3xl font-bold font-mono ${avgScore >= 60 ? 'text-emerald-500' : avgScore >= 40 ? 'text-amber-500' : 'text-rose-500'}`}>
            {avgScore || '—'}
          </div>
        </div>

      </div>

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
