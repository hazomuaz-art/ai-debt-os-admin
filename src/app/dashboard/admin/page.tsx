import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import {
  Wallet, BrainCircuit, CheckCircle, AlertTriangle,
  Users, TrendingUp, MessageCircle
} from 'lucide-react'

// ── Stats fetch ──────────────────────────────────────────────────────────

async function getStats(companyId: string) {
  const supabase   = createClient()
  const now        = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
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
  ] = await Promise.all([
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', companyId),
    supabase.from('debts').select('current_balance').eq('company_id', companyId).neq('status', 'settled'),
    supabase.from('payments').select('amount').eq('company_id', companyId).gte('payment_date', monthStart),
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
  ])

  const totalBalance   = balanceData?.reduce((s, d) => s + Number(d.current_balance ?? 0), 0) ?? 0
  const totalCollected = collectedData?.reduce((s, p) => s + Number(p.amount ?? 0), 0) ?? 0

  const statusCount: Record<string, number> = {}
  for (const d of statusBreakdown ?? []) {
    statusCount[d.status] = (statusCount[d.status] ?? 0) + 1
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

  // Real collection rate from available figures (no hardcoded number)
  const collectionRate = (s.totalCollected + s.totalBalance) > 0
    ? Math.round((s.totalCollected / (s.totalCollected + s.totalBalance)) * 100)
    : 0
  const ringCirc = 251
  const ringOffset = Math.round(ringCirc * (1 - collectionRate / 100))

  const kpis = [
    { title: 'رسائل AI اليوم', value: String(s.messagesToday || s.aiActionsToday || 0), icon: BrainCircuit, chip: 'bg-blue-50 text-blue-600' },
    { title: 'العملاء النشطون', value: String(s.activeCustomers), icon: Users, chip: 'bg-indigo-50 text-indigo-600' },
    { title: 'وعود السداد', value: String(s.statusCount['promised'] ?? 0), icon: CheckCircle, chip: 'bg-emerald-50 text-emerald-600' },
    { title: 'مطالبات متأخرة', value: String(s.overdueDebts ?? 0), icon: AlertTriangle, chip: 'bg-rose-50 text-rose-600', alert: true },
  ]

  // Status distribution (real data)
  const statusLabels: Record<string, string> = {
    active: 'نشط', overdue: 'متأخر', payment_plan: 'خطة تقسيط', promised: 'وعد سداد',
    settled: 'مسدد', disputed: 'معترض', legal: 'قانوني', new: 'جديد', written_off: 'مشطوب',
  }
  const statusEntries = Object.entries(s.statusCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
  const maxStatus = Math.max(1, ...statusEntries.map(([, n]) => n))

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#e7f6ef] font-sans text-slate-800">

      {/* Header */}
      <div className="flex items-center justify-between pt-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0e7a54]">الرئيسية</h1>
          <p className="text-sm text-slate-500 mt-1">نظرة شاملة على التحصيل</p>
        </div>
      </div>

      {/* Featured + collection ring */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 relative overflow-hidden rounded-3xl p-7 text-white bg-gradient-to-l from-[#0b8f63] to-[#0e9f6e] shadow-sm">
          <div className="absolute -left-6 -bottom-10 w-40 h-40 rounded-full bg-white/10"></div>
          <div className="absolute left-16 -top-12 w-28 h-28 rounded-full bg-white/5"></div>
          <div className="relative">
            <div className="text-sm text-white/85">المحصّل هذا الشهر</div>
            <div className="text-4xl font-bold font-mono mt-2">{formatCurrency(s.totalCollected, 'SAR')}</div>
            <div className="flex items-center gap-5 mt-4 text-xs text-white/90">
              <span className="inline-flex items-center gap-1.5"><TrendingUp size={15} /> إجمالي المديونيات: {formatCurrency(s.totalBalance, 'SAR')}</span>
              <span className="inline-flex items-center gap-1.5"><Wallet size={15} /> {s.totalDebts} ملف</span>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm flex flex-col items-center justify-center text-center">
          <h3 className="text-sm font-bold text-[#0e7a54] mb-3">نسبة التحصيل</h3>
          <svg viewBox="0 0 100 100" className="w-28 h-28">
            <circle cx="50" cy="50" r="40" fill="none" stroke="#eef0f4" strokeWidth="11" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#0e9f6e" strokeWidth="11" strokeDasharray={ringCirc} strokeDashoffset={ringOffset} strokeLinecap="round" transform="rotate(-90 50 50)" />
            <text x="50" y="56" textAnchor="middle" fontSize="20" fontWeight="700" fill="#0e7a54">{collectionRate}%</text>
          </svg>
          <div className="text-xs text-slate-500 mt-3">من إجمالي المحفظة</div>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k, i) => (
          <div key={i} className={`bg-white rounded-2xl p-5 border ${k.alert ? 'border-rose-100' : 'border-slate-100'} shadow-sm hover:shadow-md transition-shadow`}>
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${k.chip}`}>
              <k.icon size={22} strokeWidth={2.4} />
            </div>
            <div className={`text-2xl font-bold font-mono ${k.alert ? 'text-rose-600' : 'text-[#0e7a54]'}`}>{k.value}</div>
            <div className="text-sm text-slate-500 mt-1">{k.title}</div>
          </div>
        ))}
      </div>

      {/* Live feed + status distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-100 rounded-3xl overflow-hidden shadow-sm flex flex-col">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-lg font-bold text-[#0e7a54] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              العمليات اللحظية
            </h2>
            <button className="text-sm text-[#0e7a54] hover:text-[#0b8f63] font-bold bg-[#e7f6ef] hover:bg-[#d9f0e6] px-4 py-2 rounded-xl transition-colors">عرض السجل الكامل</button>
          </div>
          <div className="overflow-x-auto flex-1 p-2">
            <table className="w-full text-start">
              <thead className="text-slate-400 text-xs font-bold border-b border-slate-100">
                <tr>
                  <th className="px-5 py-4">العميل</th>
                  <th className="px-5 py-4">المبلغ</th>
                  <th className="px-5 py-4">نوع الإجراء (AI)</th>
                  <th className="px-5 py-4">الوقت</th>
                  <th className="px-5 py-4">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {s.recentActions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400 font-bold">لا توجد عمليات مسجلة اليوم</td>
                  </tr>
                ) : s.recentActions.map((action) => {
                  const clientName = (action.customer as { full_name?: string } | null)?.full_name ?? 'عميل غير معروف'
                  const balance = (action.debt as { current_balance?: number } | null)?.current_balance ?? 0
                  const currency = (action.debt as { currency?: string } | null)?.currency ?? 'SAR'
                  const formattedTime = new Date(action.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })

                  return (
                    <tr key={action.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-4 text-sm font-bold text-[#0e7a54]">{clientName}</td>
                      <td className="px-5 py-4 text-sm font-bold text-emerald-600 font-mono">{formatCurrency(balance, currency)}</td>
                      <td className="px-5 py-4">
                        {action.action_type === 'whatsapp' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
                            محادثة واتساب
                          </span>
                        ) : action.action_type === 'call' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-purple-50 text-purple-600 border border-purple-100">
                            مكالمة صوتية
                          </span>
                        ) : action.action_type === 'email' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-600 border border-blue-100">
                            بريد إلكتروني
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
                            {action.action_type}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-sm font-bold text-slate-400 font-mono">{formattedTime}</td>
                      <td className="px-5 py-4">
                        <span className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${action.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                          {action.status === 'completed' ? 'نجح الإرسال' : 'قيد المعالجة'}
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
        <div className="bg-white border border-slate-100 rounded-3xl shadow-sm p-6">
          <h3 className="text-lg font-bold text-[#0e7a54] mb-5">توزيع حالات الملفات</h3>
          {statusEntries.length === 0 ? (
            <div className="text-sm text-slate-400 py-8 text-center">لا توجد بيانات</div>
          ) : (
            <div className="space-y-4">
              {statusEntries.map(([key, n]) => (
                <div key={key}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-slate-600">{statusLabels[key] ?? key}</span>
                    <span className="font-bold text-[#0e7a54] font-mono">{n}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#eef0f4] overflow-hidden">
                    <div className="h-full rounded-full bg-[#0e9f6e]" style={{ width: `${Math.round((n / maxStatus) * 100)}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><MessageCircle size={20} /></div>
            <div>
              <div className="text-sm font-bold text-[#0e7a54]">{s.messagesToday || s.aiActionsToday || 0} رسالة اليوم</div>
              <div className="text-xs text-slate-500">عبر الوكيل الذكي</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
