import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { 
  Wallet, BrainCircuit, CheckCircle, AlertTriangle, 
  Clock, Activity, MessageCircle, FileText, ArrowLeftRight
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
  const firstName = profile.full_name?.split(' ')[0] ?? 'المشرف'

  // Stats matching the custom template
  const stats = [
    { 
      title: 'إجمالي التحصيل (الشهري)', 
      value: formatCurrency(s.totalCollected, 'SAR'), 
      icon: Wallet, 
      color: 'text-emerald-400', 
      bg: 'bg-emerald-400/10' 
    },
    { 
      title: 'رسائل AI اليومية', 
      value: String(s.messagesToday || s.aiActionsToday || 0), 
      icon: BrainCircuit, 
      color: 'text-blue-400', 
      bg: 'bg-blue-400/10' 
    },
    { 
      title: 'وعود السداد النشطة', 
      value: String(s.statusCount['promised'] ?? 0), 
      icon: CheckCircle, 
      color: 'text-purple-400', 
      bg: 'bg-purple-400/10' 
    },
    { 
      title: 'مراجعات تتطلب تدخلاً', 
      value: String(s.overdueDebts ?? 0), 
      icon: AlertTriangle, 
      color: 'text-rose-400', 
      bg: 'bg-rose-400/10' 
    },
  ]

  return (
    <div className="space-y-8 animate-in" dir="rtl">
      
      {/* ── Welcome Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap pb-2">
        <div>
          <h1 className="font-display font-bold text-2xl text-slate-50 flex items-center gap-2">
            مرحباً بك مجدداً، {firstName}
            <span className="animate-pulse">👋</span>
          </h1>
          <p className="text-slate-400 text-xs mt-1">
            إليك نظرة سريعة على مجريات عمليات التحصيل الذكية اليوم.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/dashboard/admin/debts" className="btn-secondary text-xs px-3 py-2 rounded-xl">
            الملفات والديون
          </Link>
          <Link href="/dashboard/admin/ai-actions" className="btn-primary text-xs px-3 py-2 rounded-xl">
            إجراءات AI
          </Link>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, idx) => (
          <div 
            key={idx} 
            className="bg-slate-900/50 backdrop-blur-md border border-white/5 p-6 rounded-2xl flex flex-col gap-4 relative overflow-hidden group hover:border-brand-500/20 transition-all duration-300"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.bg} ${stat.color} shadow-sm`}>
              <stat.icon size={22} />
            </div>
            <div>
              <h3 className="text-slate-400 text-xs font-semibold mb-1 uppercase tracking-wide">{stat.title}</h3>
              <p className="text-2xl font-bold text-slate-100 font-display">{stat.value}</p>
            </div>
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent to-transparent group-hover:from-blue-500 group-hover:to-purple-500 transition-all opacity-0 group-hover:opacity-100"></div>
          </div>
        ))}
      </div>

      {/* ── Live Operations Monitor ── */}
      <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden flex flex-col shadow-card">
        <div className="p-5 border-b border-white/5 flex justify-between items-center bg-slate-950/20">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <h2 className="text-sm font-semibold text-slate-200 font-display">مراقبة العمليات اللحظية (AI Control Center)</h2>
          </div>
          <Link href="/dashboard/admin/ai-actions" className="text-xs text-brand-400 hover:text-brand-300 font-semibold flex items-center gap-1">
            عرض السجل الكامل ←
          </Link>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right border-collapse">
            <thead className="bg-slate-950/40 text-slate-400 border-b border-white/5">
              <tr>
                <th className="px-6 py-4.5 font-semibold uppercase tracking-wider">العميل / المطالبة</th>
                <th className="px-6 py-4.5 font-semibold uppercase tracking-wider">المبلغ المتبقي</th>
                <th className="px-6 py-4.5 font-semibold uppercase tracking-wider">نوع الإجراء</th>
                <th className="px-6 py-4.5 font-semibold uppercase tracking-wider">الوقت التاريخ</th>
                <th className="px-6 py-4.5 font-semibold uppercase tracking-wider text-left pl-6">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {s.recentActions.map((action) => {
                const clientName = (action.customer as { full_name?: string } | null)?.full_name ?? 'عميل غير معروف'
                const refNum = (action.debt as { reference_number?: string } | null)?.reference_number ?? '---'
                const balance = (action.debt as { current_balance?: number } | null)?.current_balance ?? 0
                const currency = (action.debt as { currency?: string } | null)?.currency ?? 'SAR'

                return (
                  <tr key={action.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-200">{clientName}</div>
                      <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{refNum}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-300 font-mono font-medium">
                      {formatCurrency(balance, currency)}
                    </td>
                    <td className="px-6 py-4">
                      {action.action_type === 'whatsapp' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/10">
                          <MessageCircle size={12} /> تفاوض واتساب
                        </span>
                      )}
                      {action.action_type === 'call' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/10">
                          <BrainCircuit size={12} /> مكالمة صوتية AI
                        </span>
                      )}
                      {action.action_type === 'email' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/10">
                          <FileText size={12} /> بريد إلكتروني
                        </span>
                      )}
                      {action.action_type !== 'whatsapp' && action.action_type !== 'call' && action.action_type !== 'email' && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold bg-slate-500/10 text-slate-400 border border-slate-500/10">
                          <ArrowLeftRight size={12} /> {action.action_type}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-400 font-mono">{formatDate(action.created_at)}</td>
                    <td className="px-6 py-4 text-left pl-6">
                      <span className={cn(
                        "text-[10px] font-bold px-3 py-1 rounded-full border",
                        action.status === 'completed'
                          ? "bg-emerald-500/5 text-emerald-400 border-emerald-500/10"
                          : "bg-amber-500/5 text-amber-400 border-amber-500/10"
                      )}>
                        {action.status === 'completed' ? 'نجح الإرسال' : 'بانتظار التنفيذ'}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {s.recentActions.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-500 text-xs">
                    لا توجد عمليات مسجلة حالياً
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}
