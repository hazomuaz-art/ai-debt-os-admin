import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Wallet, MessageCircle, AlertTriangle, FileText, CheckCircle, Clock } from 'lucide-react'

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

  const totalBalance = (assignedDebts ?? []).reduce((s, d) => s + Number(d.current_balance ?? 0), 0)
  const collectedMonth = (payments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0)

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  const sortedDebts = (assignedDebts ?? []).sort((a, b) =>
    (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 4) -
    (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 4)
  )

  const actionTypeIcons: Record<string, any> = {
    call: BrainCircuitIcon,
    whatsapp: MessageCircle,
    email: FileText,
  }

  function BrainCircuitIcon(props: any) {
    return <BrainCircuit {...props} />
  }

  function BrainCircuit(props: any) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
        <path d="M12 5c1.5-2 4.5-2 6 0s1.5 4 0 5c-1 .7-2 1-3 1" />
        <path d="M12 5c-1.5-2-4.5-2-6 0s-1.5 4 0 5c1 .7 2 1 3 1" />
        <path d="M9 14c0 3 1.5 5 3 7M15 14c0 3-1.5 5-3 7" />
      </svg>
    )
  }

  const stats = [
    { label: 'الملفات المسندة', value: String(totalAssigned ?? 0), icon: FileText, color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: 'إجمالي المديونية', value: formatCurrency(totalBalance, 'SAR'), icon: Wallet, color: 'text-slate-200', bg: 'bg-slate-100/10' },
    { label: 'تحصيلي (هذا الشهر)', value: formatCurrency(collectedMonth, 'SAR'), icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
    { label: 'إجراءات اليوم المطلوبة', value: String((todayActions ?? []).length), icon: Clock, color: 'text-purple-400', bg: 'bg-purple-400/10' },
  ]

  const getPriorityStyle = (p: string) => {
    if (p === 'critical' || p === 'high') return 'bg-rose-500/10 text-rose-400 border-rose-500/20'
    if (p === 'medium') return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    return 'bg-blue-500/10 text-blue-400 border-blue-500/10'
  }

  const getStatusLabel = (s: string) => {
    const labels: Record<string, string> = {
      active: 'نشط', promised: 'وعد سداد', disputed: 'معترض', partial: 'جزئي', settled: 'مسدد بالكامل'
    }
    return labels[s] ?? s
  }

  const getPriorityLabel = (p: string) => {
    const labels: Record<string, string> = {
      critical: 'حرج جداً', high: 'مرتفع', medium: 'متوسط', low: 'منخفض'
    }
    return labels[p] ?? p
  }

  return (
    <div className="space-y-8 animate-in" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-50">قائمة مهامي التحصيلية</h1>
        <p className="text-slate-400 text-xs mt-1">
          المحصل: {profile.full_name ?? 'المحصل'} — {new Date().toLocaleDateString('ar-SA', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
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
              <h3 className="text-slate-400 text-xs font-semibold mb-1 uppercase tracking-wide">{stat.label}</h3>
              <p className="text-xl font-bold text-slate-50 font-display">{stat.value}</p>
            </div>
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent to-transparent group-hover:from-blue-500 group-hover:to-purple-500 transition-all opacity-0 group-hover:opacity-100"></div>
          </div>
        ))}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Today's Actions */}
        <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-5 flex flex-col shadow-card">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
            <h2 className="text-sm font-semibold text-slate-200 font-display">إجراءات اليوم المستحقة</h2>
            <Link href="/dashboard/collector/actions" className="text-xs text-brand-400 hover:text-brand-300 font-semibold">عرض الكل ←</Link>
          </div>

          <div className="space-y-3 flex-1">
            {(todayActions ?? []).length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">لا توجد إجراءات مجدولة لليوم</div>
            ) : (todayActions ?? []).map((action) => {
              const ActionIcon = actionTypeIcons[action.action_type] || FileText
              return (
                <div key={action.id} className="flex items-start gap-3.5 p-3.5 bg-slate-950/20 border border-white/[0.04] rounded-xl hover:border-white/10 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-slate-400 shrink-0">
                    <ActionIcon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-200">{(action.customer as {full_name?: string} | null)?.full_name}</span>
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded border ${getPriorityStyle(action.priority)}`}>
                        {getPriorityLabel(action.priority)}
                      </span>
                    </div>
                    <div className="text-slate-400 text-[10px] mt-1 line-clamp-2 leading-relaxed">{action.reason}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Assigned debts */}
        <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl p-5 flex flex-col shadow-card">
          <div className="flex items-center justify-between mb-4 pb-2 border-b border-white/5">
            <h2 className="text-sm font-semibold text-slate-200 font-display">أعلى ملفات الديون الأولوية</h2>
            <Link href="/dashboard/collector/debts" className="text-xs text-brand-400 hover:text-brand-300 font-semibold">عرض الكل ←</Link>
          </div>

          <div className="space-y-3 flex-1">
            {sortedDebts.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-xs">لا توجد ديون مسندة لك حالياً</div>
            ) : sortedDebts.slice(0, 5).map((debt) => (
              <div key={debt.id} className="flex items-center justify-between p-3.5 bg-slate-950/20 border border-white/[0.04] rounded-xl hover:border-white/10 transition-colors">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-200">{(debt.customer as {full_name?: string} | null)?.full_name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[9px] text-slate-500">{debt.reference_number}</span>
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-white/5">
                      {getStatusLabel(debt.status)}
                    </span>
                  </div>
                </div>
                <div className="text-left">
                  <div className="text-xs font-bold text-slate-100 font-mono">{formatCurrency(debt.current_balance, debt.currency)}</div>
                  <span className={`text-[9px] font-bold px-2 py-0.5 rounded border inline-block mt-1 ${getPriorityStyle(debt.priority)}`}>
                    {getPriorityLabel(debt.priority)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
