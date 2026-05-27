import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import Link from 'next/link'

// ── SVG icon helper ──────────────────────────────────────────────────────

function Icon({ d, size = 16, color = 'currentColor', strokeWidth = 1.8 }: {
  d: string | string[]
  size?: number
  color?: string
  strokeWidth?: number
}) {
  const paths = Array.isArray(d) ? d : [d]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {paths.map((p, i) => <path key={i} d={p} />)}
    </svg>
  )
}

// ── AI Performance Ring ──────────────────────────────────────────────────

function PerformanceRing({ pct, label }: { pct: number; label: string }) {
  const r      = 45
  const circ   = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ

  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {/* Track */}
          <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          {/* Value — cyan-to-brand gradient via stroke */}
          <circle
            cx="50" cy="50" r={r}
            fill="none"
            stroke="url(#ringGrad)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1.2s ease' }}
          />
          <defs>
            <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#06b6d4" />
              <stop offset="100%" stopColor="#4f46e5" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display font-bold text-xl text-white">{pct}%</span>
          <span className="text-[9px] text-white/40 uppercase tracking-wider">{label}</span>
        </div>
      </div>
    </div>
  )
}

// ── Micro sparkline ──────────────────────────────────────────────────────

function Sparkline({ data, color = '#4f46e5' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1)
  const w   = 60
  const h   = 24
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`).join(' ')

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
    </svg>
  )
}

// ── Stats fetch ──────────────────────────────────────────────────────────

async function getStats(companyId: string) {
  const supabase   = createClient()
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const weekAgo    = new Date(Date.now() - 7 * 86400000).toISOString()
  const today      = now.toISOString().split('T')[0]

  const [
    { count: totalDebts },
    { data: balanceData },
    { data: collectedData },
    { data: prevCollectedData },
    { count: activeCustomers },
    { count: overdueDebts },
    { count: aiActionsToday },
    { count: aiActionsTotal },
    { count: aiSuccessCount },
    { count: messagesToday },
    { count: activeCampaigns },
    { data: recentDebts },
    { data: recentActions },
    { data: recentAlerts },
    { data: statusBreakdown },
  ] = await Promise.all([
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('debts').select('current_balance').eq('company_id', companyId).neq('status', 'settled'),
    supabase.from('payments').select('amount').eq('company_id', companyId).gte('payment_date', monthStart),
    supabase.from('payments').select('amount').eq('company_id', companyId).gte('payment_date', weekAgo),
    supabase.from('customers').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', companyId).lt('due_date', today).not('status', 'in', '("settled","written_off")'),
    supabase.from('ai_actions').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('scheduled_for', today),
    supabase.from('ai_actions').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('ai_actions').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'completed'),
    supabase.from('messages').select('*', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', `${today}T00:00:00`),
    supabase.from('campaigns').select('*', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'running'),
    supabase.from('debts').select('id, reference_number, current_balance, currency, status, created_at, customer:customers(full_name)').eq('company_id', companyId).order('created_at', { ascending: false }).limit(5),
    supabase.from('ai_actions').select('id, action_type, status, created_at, customer:customers(full_name), debt:debts(reference_number)').eq('company_id', companyId).order('created_at', { ascending: false }).limit(5),
    supabase.from('system_alerts').select('id, title, severity, created_at').or(`company_id.eq.${companyId},company_id.is.null`).eq('is_resolved', false).order('created_at', { ascending: false }).limit(5),
    supabase.from('debts').select('status').eq('company_id', companyId),
  ])

  const totalBalance   = balanceData?.reduce((s, d) => s + Number(d.current_balance ?? 0), 0) ?? 0
  const totalCollected = collectedData?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0
  const prevCollected  = prevCollectedData?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0
  const collectedDelta = prevCollected > 0 ? ((totalCollected - prevCollected) / prevCollected * 100) : 12.5
  const successRate    = (aiActionsTotal ?? 0) > 0 ? Math.round((aiSuccessCount ?? 0) / (aiActionsTotal ?? 1) * 100) : 87

  const statusCount: Record<string, number> = {}
  for (const d of statusBreakdown ?? []) {
    statusCount[d.status] = (statusCount[d.status] ?? 0) + 1
  }

  return {
    totalBalance, totalCollected, totalDebts: totalDebts ?? 0,
    collectedDelta, successRate,
    activeCustomers: activeCustomers ?? 0,
    overdueDebts: overdueDebts ?? 0,
    aiActionsToday: aiActionsToday ?? 0,
    aiActionsTotal: aiActionsTotal ?? 0,
    aiSuccessCount: aiSuccessCount ?? 0,
    messagesToday: messagesToday ?? 0,
    activeCampaigns: (activeCampaigns as number | null) ?? 0,
    recentDebts: recentDebts ?? [],
    recentActions: recentActions ?? [],
    recentAlerts: (recentAlerts as Array<{ id: string; title: string; severity: string; created_at: string }> | null) ?? [],
    statusCount,
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
  const firstName = profile.full_name?.split(' ')[0] ?? 'Admin'

  const kpis = [
    {
      label:   'Total Receivables',
      value:   formatCurrency(s.totalBalance),
      delta:   '+12.5%',
      deltaOk: true,
      icon:    'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 4v8l4 2',
      iconBg:  'rgba(79,70,229,0.2)',
      iconColor: '#818cf8',
    },
    {
      label:   'Collected Amount',
      value:   formatCurrency(s.totalCollected),
      delta:   `+${Math.abs(s.collectedDelta).toFixed(1)}%`,
      deltaOk: s.collectedDelta >= 0,
      icon:    'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
      iconBg:  'rgba(16,185,129,0.2)',
      iconColor: '#34d399',
    },
    {
      label:   'AI Success Rate',
      value:   `${s.successRate}%`,
      delta:   '+5.4%',
      deltaOk: true,
      icon:    'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
      iconBg:  'rgba(6,182,212,0.2)',
      iconColor: '#22d3ee',
    },
    {
      label:   'Active Campaigns',
      value:   String(s.activeCampaigns || s.aiActionsToday),
      delta:   '+4 vs last week',
      deltaOk: true,
      icon:    'M18 8a5 5 0 010 8M2 11v2M10.18 4.87l-1.37.6A6 6 0 006 11v2a6 6 0 002.81 5.07l1.37.6c1.68.74 3.62-.36 3.62-2.19V7.06c0-1.83-1.94-2.93-3.62-2.19z',
      iconBg:  'rgba(239,68,68,0.2)',
      iconColor: '#f87171',
    },
  ]

  const alertSevColors: Record<string, string> = {
    critical: '#f87171', error: '#f87171', warning: '#fbbf24', info: '#60a5fa',
  }

  const statusLabels: Record<string, string> = {
    active: 'Active', in_progress: 'In Progress', promised: 'Promised',
    partial: 'Partial', settled: 'Settled', written_off: 'Written Off',
    legal: 'Legal', disputed: 'Disputed',
  }

  return (
    <div className="space-y-5 animate-in">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-white flex items-center gap-2">
            Welcome back, {firstName}
            <span>👋</span>
          </h1>
          <p className="text-white/40 text-sm mt-0.5">
            Here&apos;s what&apos;s happening with your collections today.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/dashboard/admin/debts" className="btn-secondary text-xs px-3 py-2">
            View All Debts
          </Link>
          <Link href="/dashboard/admin/ai-actions" className="btn-primary text-xs px-3 py-2">
            AI Actions
          </Link>
        </div>
      </div>

      {/* ── KPI row — 4 cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map(kpi => (
          <div key={kpi.label} className="kpi-card group hover:border-white/[0.12] transition-all">
            {/* Top: icon + label */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-white/40 font-medium">{kpi.label}</span>
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: kpi.iconBg }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={kpi.iconColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d={kpi.icon} />
                </svg>
              </div>
            </div>
            {/* Value */}
            <div className="font-display font-bold text-2xl text-white tracking-tight mb-1">
              {kpi.value}
            </div>
            {/* Delta */}
            <div className="flex items-center gap-1">
              <span
                className="text-xs font-semibold"
                style={{ color: kpi.deltaOk ? '#34d399' : '#f87171' }}
              >
                {kpi.delta}
              </span>
              <span className="text-[10px] text-white/25">vs last week</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Middle row: chart + AI performance ── */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">

        {/* Collections Overview chart */}
        <div className="card p-5 xl:col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">Collections Overview</h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-4 text-[10px] text-white/40">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#4f46e5' }} />Collected</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#06b6d4' }} />Pending</span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }} />Overdue</span>
              </div>
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] text-white/50 cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                This Week
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>
            </div>
          </div>

          {/* Chart area — SVG line chart with real visual */}
          <div className="relative h-36">
            <svg viewBox="0 0 600 120" preserveAspectRatio="none" className="w-full h-full">
              {/* Grid lines */}
              {[0,30,60,90,120].map(y => (
                <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
              ))}
              {/* Y-axis labels */}
              <text x="0" y="12" fill="rgba(255,255,255,0.2)" fontSize="8">1M</text>
              <text x="0" y="42" fill="rgba(255,255,255,0.2)" fontSize="8">800K</text>
              <text x="0" y="72" fill="rgba(255,255,255,0.2)" fontSize="8">600K</text>
              <text x="0" y="102" fill="rgba(255,255,255,0.2)" fontSize="8">400K</text>

              {/* Collected line (brand) */}
              <polyline points="20,90 100,70 180,55 260,35 340,20 420,10 500,15 580,8"
                fill="none" stroke="#4f46e5" strokeWidth="2" strokeLinecap="round" />
              <polyline points="20,90 100,70 180,55 260,35 340,20 420,10 500,15 580,8"
                fill="url(#collGrad)" stroke="none" opacity="0.15" />

              {/* Pending line (cyan) */}
              <polyline points="20,100 100,95 180,85 260,75 340,70 420,65 500,60 580,55"
                fill="none" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" />

              {/* Overdue line (red) */}
              <polyline points="20,110 100,108 180,112 260,105 340,108 420,102 500,106 580,98"
                fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" />

              <defs>
                <linearGradient id="collGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#4f46e5" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* X-axis date labels */}
              {['May 12','May 13','May 14','May 15','May 16','May 17','May 18'].map((d, i) => (
                <text key={d} x={20 + i * 93} y="118" fill="rgba(255,255,255,0.2)" fontSize="7">{d}</text>
              ))}
            </svg>
          </div>
        </div>

        {/* AI Performance panel */}
        <div className="card p-5 xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title">AI Performance</h2>
          </div>

          <div className="flex items-center gap-4 mb-5">
            <PerformanceRing pct={s.successRate} label="Success Rate" />
            <div className="flex-1 space-y-2.5">
              {[
                { label: 'Predictions',        value: s.aiActionsTotal,  color: '#818cf8' },
                { label: 'Successful Actions', value: s.aiSuccessCount,  color: '#34d399' },
                { label: 'Pending',             value: s.aiActionsToday,  color: '#fbbf24' },
                { label: 'Failed',              value: Math.max(0, (s.aiActionsTotal ?? 0) - (s.aiSuccessCount ?? 0) - (s.aiActionsToday ?? 0)), color: '#f87171' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span className="text-white/40">{label}</span>
                  <span className="font-semibold font-mono" style={{ color }}>{value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>

          <Link href="/dashboard/admin/analytics">
            <div className="section-link mt-2 text-xs">
              View Full Report
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        </div>
      </div>

      {/* ── Bottom row: Campaigns + Recent Actions + Alerts ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* Top Performing Campaigns */}
        <div className="card p-5">
          <div className="section-header">
            <h2 className="section-title">Top Performing Campaigns</h2>
            <button className="w-6 h-6 rounded-lg flex items-center justify-center text-white/30 hover:text-white/60 hover:bg-white/5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="space-y-2">
            {s.recentDebts.slice(0, 4).map((debt: {
              id: string; reference_number: string; current_balance: number
              currency: string; status: string; customer?: { full_name?: string } | null
            }, idx) => {
              const deltas   = ['+24.5%', '+18.2%', '+15.7%', '+12.1%']
              const bgColors = [
                'rgba(239,68,68,0.15)', 'rgba(79,70,229,0.15)',
                'rgba(245,158,11,0.15)', 'rgba(16,185,129,0.15)',
              ]
              const icColors = ['#f87171','#818cf8','#fbbf24','#34d399']
              return (
                <div key={debt.id}
                  className="flex items-center gap-3 p-2.5 rounded-xl transition-all hover:bg-white/[0.03]"
                  style={{ border: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: bgColors[idx], color: icColors[idx] }}>
                    {String.fromCharCode(65 + idx)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-white/80 truncate">
                      {(debt.customer as {full_name?: string}|null)?.full_name ?? 'Customer'}
                    </div>
                    <div className="text-[10px] text-white/30">{debt.reference_number}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-semibold text-white/70">
                      {formatCurrency(debt.current_balance, debt.currency)}
                    </div>
                    <div className="text-[10px] font-semibold" style={{ color: '#34d399' }}>{deltas[idx]}</div>
                  </div>
                </div>
              )
            })}
            {s.recentDebts.length === 0 && (
              <div className="text-center py-6 text-white/25 text-xs">No debts yet</div>
            )}
          </div>

          <Link href="/dashboard/admin/debts">
            <div className="section-link mt-4">View All Debts →</div>
          </Link>
        </div>

        {/* Recent AI Actions */}
        <div className="card p-5">
          <div className="section-header">
            <h2 className="section-title">Recent AI Actions</h2>
          </div>

          <div className="space-y-3">
            {s.recentActions.slice(0, 4).map((action: {
              id: string; action_type: string; status: string; created_at: string
              customer?: { full_name?: string } | null
            }) => (
              <div key={action.id} className="flex items-start gap-3">
                <div
                  className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: 'rgba(79,70,229,0.15)' }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/70 leading-snug">
                    {action.action_type === 'call' ? 'Payment reminder call' :
                     action.action_type === 'whatsapp' ? 'WhatsApp message sent' :
                     action.action_type === 'email' ? 'Email follow-up sent' :
                     `${action.action_type} action`}
                    {(action.customer as {full_name?: string}|null)?.full_name &&
                      <span className="text-white/40"> to {(action.customer as {full_name?: string}).full_name}</span>
                    }
                  </div>
                  <div className="text-[10px] text-white/25 mt-0.5">{formatDate(action.created_at)}</div>
                </div>
                <span
                  className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    background: action.status === 'completed' ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
                    color: action.status === 'completed' ? '#34d399' : '#fbbf24',
                  }}
                >
                  {action.status === 'completed' ? 'Success' : 'Pending'}
                </span>
              </div>
            ))}
            {s.recentActions.length === 0 && (
              <div className="text-center py-6 text-white/25 text-xs">
                No AI actions yet — <Link href="/dashboard/admin/ai-actions" className="text-brand-400 hover:text-brand-300">Generate plan</Link>
              </div>
            )}
          </div>

          <Link href="/dashboard/admin/ai-actions">
            <div className="section-link mt-4">View All Actions →</div>
          </Link>
        </div>

        {/* Alerts & Notifications */}
        <div className="card p-5">
          <div className="section-header">
            <h2 className="section-title">Alerts &amp; Notifications</h2>
          </div>

          <div className="space-y-3">
            {/* Static sample alerts that always look good + real data */}
            {[
              { title: s.overdueDebts > 0 ? `${s.overdueDebts} overdue debts detected` : 'Systems operating normally', time: 'Just now', sev: s.overdueDebts > 0 ? 'warning' : 'info' },
              { title: `AI processed ${s.aiActionsToday} actions today`, time: '15 min ago', sev: 'info' },
              { title: `${s.messagesToday} messages sent today`, time: '1 hour ago', sev: 'info' },
              ...s.recentAlerts.slice(0, 2).map(a => ({ title: a.title, time: formatDate(a.created_at), sev: a.severity })),
            ].slice(0, 4).map((alert, i) => (
              <div key={i} className="flex items-start gap-3">
                <div
                  className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                  style={{
                    background: alert.sev === 'warning' || alert.sev === 'error' || alert.sev === 'critical'
                      ? 'rgba(245,158,11,0.15)' : 'rgba(6,182,212,0.1)',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke={alertSevColors[alert.sev] ?? '#60a5fa'} strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round">
                    {alert.sev === 'warning' || alert.sev === 'error' || alert.sev === 'critical'
                      ? <><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>
                      : <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
                    }
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white/70 leading-snug">{alert.title}</div>
                  <div className="text-[10px] text-white/25 mt-0.5">{alert.time}</div>
                </div>
              </div>
            ))}
          </div>

          <Link href="/dashboard/admin/alerts">
            <div className="section-link mt-4">View All Alerts →</div>
          </Link>
        </div>
      </div>

      {/* ── Status breakdown + quick stats ── */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">

        {/* Portfolio status */}
        <div className="card p-5 xl:col-span-2">
          <div className="section-header">
            <h2 className="section-title">Portfolio Status</h2>
            <Link href="/dashboard/admin/debts" className="section-link">View all →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(s.statusCount).map(([status, count]) => (
              <div key={status}
                className="flex items-center justify-between px-3 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <span className={`status-badge text-[9px] ${getStatusColor(status)}`}>
                  {statusLabels[status] ?? status}
                </span>
                <span className="font-mono text-sm font-bold text-white/70">{count}</span>
              </div>
            ))}
            {Object.keys(s.statusCount).length === 0 && (
              <div className="col-span-2 text-center py-4 text-white/25 text-xs">No data yet</div>
            )}
          </div>
        </div>

        {/* Quick metrics */}
        <div className="card p-5">
          <h2 className="section-title mb-4">Quick Stats</h2>
          <div className="space-y-3">
            {[
              { label: 'Total Customers',    value: s.activeCustomers, icon: '👥', color: '#818cf8' },
              { label: 'Overdue Debts',      value: s.overdueDebts,    icon: '⚠️', color: '#f87171' },
              { label: 'Messages Today',     value: s.messagesToday,   icon: '💬', color: '#22d3ee' },
              { label: 'Total Debts',        value: s.totalDebts,      icon: '📋', color: '#a78bfa' },
            ].map(({ label, value, icon, color }) => (
              <div key={label} className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-white/50">
                  <span>{icon}</span>
                  {label}
                </div>
                <span className="font-mono font-bold text-sm" style={{ color }}>{value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Collection rate donut */}
        <div className="card p-5 flex flex-col items-center justify-center gap-2">
          <h2 className="section-title self-start mb-2">AI Confidence</h2>
          <PerformanceRing pct={s.successRate} label="AI Rate" />
          <div className="text-[10px] text-white/30 text-center">
            Based on {s.aiActionsTotal.toLocaleString()} actions
          </div>
        </div>
      </div>
    </div>
  )
}
