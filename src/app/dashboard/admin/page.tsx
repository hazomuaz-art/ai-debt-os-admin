import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import { getServerTranslation } from '@/lib/i18n/server'
import Link from 'next/link'
import {
  Wallet, BrainCircuit, CheckCircle, AlertTriangle,
  TrendingUp, MessageCircle, ArrowUpRight, ArrowDownRight, BellRing
} from 'lucide-react'

// ── Stats fetch ──────────────────────────────────────────────────────────

async function getStats(companyId: string) {
  const supabase   = createClient()
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const today      = now.toISOString().split('T')[0]

  const [
    { count: totalDebts },
    { data: balanceData },
    { data: collectedData },
    { count: activeCustomers },
    { count: overdueDebts },
    { count: aiActionsToday },
    { count: messagesToday },
    { data: recentActions },
    { data: statusBreakdown },
    { data: lastMonthData },
    { data: criticalAlerts },
  ] = await Promise.all([
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('debts').select('current_balance').eq('company_id', companyId).neq('status', 'settled'),
    supabase.from('payments').select('amount, payment_date').eq('company_id', companyId).gte('payment_date', monthStart),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', companyId).lt('due_date', today).not('status', 'in', '("settled","written_off")'),
    supabase.from('ai_actions').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('scheduled_for', today),
    supabase.from('messages').select('*', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', `${today}T00:00:00`),
    supabase.from('ai_actions')
      .select('id, action_type, status, created_at, customer:customers(full_name), debt:debts(reference_number, current_balance, currency)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(6),
    supabase.from('debts').select('status').eq('company_id', companyId),
    supabase.from('payments').select('amount').eq('company_id', companyId).gte('payment_date', lastMonthStart).lt('payment_date', monthStart),
    // Real incident (2026-07-04): a critical WhatsApp-disconnected alert was
    // correctly created by the health-check cron within 2 minutes of the
    // outage, but sat unresolved for 2 full days because nothing outside the
    // dedicated /alerts page ever surfaced it - nobody visits that page daily.
    // Surfacing unresolved critical alerts directly on the page admins
    // actually open every day closes that visibility gap at its root.
    supabase.from('system_alerts')
      .select('id, severity, alert_type, title, message, created_at')
      .eq('company_id', companyId)
      .eq('is_resolved', false)
      .eq('severity', 'critical')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  const totalBalance   = balanceData?.reduce((s, d) => s + Number(d.current_balance ?? 0), 0) ?? 0
  const totalCollected = collectedData?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0
  const lastMonthCollected = lastMonthData?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0
  const collectedMoM = lastMonthCollected > 0
    ? Math.round(((totalCollected - lastMonthCollected) / lastMonthCollected) * 100)
    : (totalCollected > 0 ? 100 : 0)

  const statusCount: Record<string, number> = {}
  for (const d of statusBreakdown ?? []) {
    statusCount[d.status] = (statusCount[d.status] ?? 0) + 1
  }

  // Daily collected series for the current month (real money-flow chart)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dailySeries = Array.from({ length: daysInMonth }, () => 0)
  for (const p of collectedData ?? []) {
    if (!p.payment_date) continue
    const day = new Date(p.payment_date).getDate()
    if (day >= 1 && day <= daysInMonth) dailySeries[day - 1] += Number(p.amount ?? 0)
  }

  return {
    totalBalance,
    totalCollected,
    totalDebts: totalDebts ?? 0,
    activeCustomers: activeCustomers ?? 0,
    overdueDebts: overdueDebts ?? 0,
    aiActionsToday: aiActionsToday ?? 0,
    messagesToday: messagesToday ?? 0,
    recentActions: recentActions ?? [],
    statusCount,
    dailySeries,
    collectedMoM,
    criticalAlerts: criticalAlerts ?? [],
  }
}

// ── Page ─────────────────────────────────────────────────────────────────

export default async function AdminDashboard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('company_id, full_name, role').eq('id', user.id).single()
  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/collector')

  const s = await getStats(profile.company_id)
  const { t, dir } = getServerTranslation()
  const h = t.pages.home

  // Real collection rate from available figures (no hardcoded number)
  const collectionRate = (s.totalCollected + s.totalBalance) > 0
    ? Math.round((s.totalCollected / (s.totalCollected + s.totalBalance)) * 100)
    : 0
  const ringCirc = 251
  const ringOffset = Math.round(ringCirc * (1 - collectionRate / 100))

  const kpis = [
    { title: h.collected_this_month, value: formatCurrency(s.totalCollected, 'SAR'), icon: Wallet, chip: 'bg-emerald-500/15 text-emerald-400', change: s.collectedMoM, sub: h.vs_last_month },
    { title: h.ai_messages_today, value: String(s.messagesToday || s.aiActionsToday || 0), icon: BrainCircuit, chip: 'bg-blue-500/15 text-blue-400', sub: t.ui.today },
    { title: h.payment_promises, value: String(s.statusCount['promised'] ?? 0), icon: CheckCircle, chip: 'bg-indigo-500/15 text-indigo-400', sub: h.active_promises },
    { title: h.overdue_claims, value: String(s.overdueDebts ?? 0), icon: AlertTriangle, chip: 'bg-rose-500/15 text-rose-400', sub: h.needs_action, alert: true },
  ]

  // Status distribution (real data)
  const statusLabels: Record<string, string> = dir === 'rtl' ? {
    active: 'نشط', overdue: 'متأخر', payment_plan: 'خطة تقسيط', promised: 'وعد سداد',
    settled: 'مسدد', disputed: 'معترض', legal: 'قانوني', new: 'جديد', written_off: 'مشطوب',
    in_progress: 'قيد التنفيذ', in_negotiation: 'في التفاوض', partial: 'سداد جزئي',
  } : {
    active: 'Active', overdue: 'Overdue', payment_plan: 'Payment plan', promised: 'Promised',
    settled: 'Settled', disputed: 'Disputed', legal: 'Legal', new: 'New', written_off: 'Written off',
    in_progress: 'In progress', in_negotiation: 'Negotiating', partial: 'Partial',
  }
  const statusEntries = Object.entries(s.statusCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const maxStatus = Math.max(1, ...statusEntries.map(([, n]) => n))

  // Money-flow area chart geometry (real daily series)
  const series = s.dailySeries.length ? s.dailySeries : [0]
  const maxV = Math.max(1, ...series)
  const CW = 600, CH = 150
  const coords = series.map((v, i) => {
    const x = series.length > 1 ? (i / (series.length - 1)) * CW : 0
    const y = CH - (v / maxV) * (CH - 24) - 12
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const linePts = coords.join(' ')
  const areaPts = `0,${CH} ${linePts} ${CW},${CH}`

  const firstName = (profile.full_name ?? '').split(' ')[0] || (dir === 'rtl' ? 'بك' : 'there')

  return (
    <div dir={dir} className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-200">

      {/* Welcome banner */}
      <div className={`relative overflow-hidden rounded-2xl mt-6 px-7 py-7 ${dir === 'rtl' ? 'bg-gradient-to-l' : 'bg-gradient-to-r'} from-[#0e7a54] via-[#0c5a45] to-[#0d1117]`}>
        <div className="relative flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{h.welcome.replace('{name}', firstName)}</h1>
            <p className="text-sm text-white/80 mt-1.5">
              {h.welcome_sub
                .replace('{msgs}', String(s.messagesToday || s.aiActionsToday || 0))
                .replace('{amount}', formatCurrency(s.totalCollected, 'SAR'))}
            </p>
          </div>
          <Link href="/dashboard/admin/analytics" className="hidden sm:flex items-center gap-2 bg-[#0d1117]/60 hover:bg-[#0d1117] border border-white/15 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors">
            {t.ui.view_analytics} <TrendingUp size={16} />
          </Link>
        </div>
      </div>

      {/* Critical unresolved alerts - surfaced here so they're seen within
          minutes, not discovered days later on the dedicated alerts page. */}
      {s.criticalAlerts.length > 0 && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <BellRing className="text-rose-400" size={20} />
            <h2 className="text-base font-bold text-rose-400">{dir === 'rtl' ? 'تنبيهات حرجة تحتاج إجراء فوري' : 'Critical alerts need action'}</h2>
          </div>
          <div className="space-y-2">
            {s.criticalAlerts.map((al: any) => (
              <Link key={al.id} href="/dashboard/admin/alerts" className="block bg-[#151a23] border border-rose-500/20 rounded-xl p-3 hover:border-rose-500/40 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white">{al.title}</span>
                  <span className="text-[10px] text-[#5f6b7e] font-bold shrink-0">{new Date(al.created_at).toLocaleString(dir === 'rtl' ? 'ar-SA' : 'en-US')}</span>
                </div>
                {al.message && <p className="text-xs text-[#8b95a7] mt-1 leading-relaxed">{al.message}</p>}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {kpis.map((k, i) => (
          <div key={i} className="bg-[#151a23] rounded-2xl p-5 border border-[#222a36]">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="text-sm text-[#8b95a7]">{k.title}</div>
                <div className={`text-2xl font-bold font-mono mt-1.5 ${k.alert ? 'text-rose-400' : 'text-white'}`}>{k.value}</div>
              </div>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${k.chip}`}>
                <k.icon size={22} strokeWidth={2.4} />
              </div>
            </div>
            {k.change !== undefined ? (
              <div className={`text-xs font-bold flex items-center gap-1 ${k.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {k.change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                {Math.abs(k.change)}% {k.sub}
              </div>
            ) : (
              <div className="text-xs text-[#5f6b7e]">{k.sub}</div>
            )}
          </div>
        ))}
      </div>

      {/* Money Flow chart + balance side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#151a23] rounded-2xl p-6 border border-[#222a36]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-white">{h.collection_flow}</h3>
              <div className="text-xl font-bold font-mono text-white mt-1">{formatCurrency(s.totalCollected, 'SAR')}</div>
            </div>
            <span className="text-xs text-[#8b95a7] bg-[#0d1117] px-3 py-1.5 rounded-lg">{t.ui.this_month}</span>
          </div>
          <svg viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" className="w-full h-44">
            <polygon points={areaPts} fill="#10b981" opacity="0.12" />
            <polyline points={linePts} fill="none" stroke="#10b981" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>

        {/* Collection goal / balance panel */}
        <div className="bg-[#151a23] rounded-2xl p-6 border border-[#222a36] flex flex-col items-center justify-center text-center">
          <h3 className="text-sm font-bold text-[#8b95a7] mb-4">{h.collection_rate}</h3>
          <svg viewBox="0 0 100 100" className="w-32 h-32">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#222a36" strokeWidth="11" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#10b981" strokeWidth="11" strokeDasharray={ringCirc} strokeDashoffset={ringOffset} strokeLinecap="round" transform="rotate(-90 50 50)" />
            <text x="50" y="56" textAnchor="middle" fontSize="22" fontWeight="700" fill="#ffffff">{collectionRate}%</text>
          </svg>
          <div className="mt-4 text-sm font-bold text-white">{formatCurrency(s.totalBalance, 'SAR')}</div>
          <div className="text-xs text-[#5f6b7e] mt-1">{h.total_debts} · {h.file_count.replace('{n}', String(s.totalDebts))}</div>
        </div>
      </div>

      {/* Live feed + status distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden flex flex-col">
          <div className="p-6 border-b border-[#222a36] flex justify-between items-center">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {h.live_ops}
            </h2>
            <Link href="/dashboard/admin/activity" className="text-sm text-emerald-400 hover:text-emerald-300 font-bold bg-emerald-500/10 hover:bg-emerald-500/20 px-4 py-2 rounded-xl transition-colors">{t.ui.view_full_log}</Link>
          </div>
          <div className="overflow-x-auto flex-1 p-2">
            <table className="w-full text-start">
              <thead className="text-[#5f6b7e] text-xs font-bold border-b border-[#222a36]">
                <tr>
                  <th className="px-5 py-4">{t.ui.customer}</th>
                  <th className="px-5 py-4">{t.ui.amount}</th>
                  <th className="px-5 py-4">{t.nav.ai_actions}</th>
                  <th className="px-5 py-4">{t.ui.time}</th>
                  <th className="px-5 py-4">{t.ui.status}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c2330]">
                {s.recentActions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-[#5f6b7e] font-bold">{h.no_ops_today}</td>
                  </tr>
                ) : s.recentActions.map((action) => {
                  const clientName = (action.customer as { full_name?: string } | null)?.full_name ?? t.ui.unknown_customer
                  const balance = (action.debt as { current_balance?: number } | null)?.current_balance ?? 0
                  const currency = (action.debt as { currency?: string } | null)?.currency ?? 'SAR'
                  const formattedTime = new Date(action.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })

                  return (
                    <tr key={action.id} className="hover:bg-[#1a212c] transition-colors">
                      <td className="px-5 py-4 text-sm font-bold text-white">{clientName}</td>
                      <td className="px-5 py-4 text-sm font-bold text-emerald-400 font-mono">{formatCurrency(balance, currency)}</td>
                      <td className="px-5 py-4">
                        {action.action_type === 'whatsapp' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            {h.whatsapp_chat}
                          </span>
                        ) : action.action_type === 'call' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                            {h.voice_call}
                          </span>
                        ) : action.action_type === 'email' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            {h.email_action}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#222a36] text-[#8b95a7] border border-[#2c3543]">
                            {action.action_type}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm font-bold text-[#5f6b7e] font-mono">{formattedTime}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${action.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
                          {action.status === 'completed' ? h.sent_ok : h.processing}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Status distribution */}
        <div className="bg-[#151a23] border border-[#222a36] rounded-2xl p-6">
          <h3 className="text-base font-bold text-white mb-5">{h.status_distribution}</h3>
          {statusEntries.length === 0 ? (
            <div className="text-sm text-[#5f6b7e] py-8 text-center">{t.ui.no_data}</div>
          ) : (
            <div className="space-y-4">
              {statusEntries.map(([key, n]) => (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-[#8b95a7]">{statusLabels[key] ?? key}</span>
                    <span className="font-bold text-white font-mono">{n}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#222a36] overflow-hidden">
                    <div className="h-full rounded-full bg-[#10b981]" style={{ width: `${Math.round((n / maxStatus) * 100)}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 pt-5 border-t border-[#222a36] flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center"><MessageCircle size={20} /></div>
            <div>
              <div className="text-sm font-bold text-white">{h.messages_today_via_ai.replace('{n}', String(s.messagesToday || s.aiActionsToday || 0))}</div>
              <div className="text-xs text-[#5f6b7e]">{h.via_ai_agent}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
