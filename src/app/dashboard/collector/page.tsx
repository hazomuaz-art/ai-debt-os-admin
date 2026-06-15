import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Wallet, MessageCircle, AlertTriangle, FileText, CheckCircle, Clock, Phone, Mail, ArrowLeft } from 'lucide-react'

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
    call: Phone,
    whatsapp: MessageCircle,
    email: Mail,
  }

  const stats = [
    { label: 'الملفات المسندة', value: String(totalAssigned ?? 0), icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50' },
    { label: 'إجمالي المديونية', value: formatCurrency(totalBalance, 'SAR'), icon: Wallet, color: 'text-[#0e7a54]', bg: 'bg-[#f6f8fa]' },
    { label: 'تحصيلي (هذا الشهر)', value: formatCurrency(collectedMonth, 'SAR'), icon: CheckCircle, color: 'text-emerald-500', bg: 'bg-emerald-50' },
    { label: 'إجراءات اليوم المطلوبة', value: String((todayActions ?? []).length), icon: Clock, color: 'text-purple-500', bg: 'bg-purple-50' },
  ]

  const getPriorityStyle = (p: string) => {
    if (p === 'critical' || p === 'high') return 'bg-rose-50 text-rose-600 border-rose-200'
    if (p === 'medium') return 'bg-amber-50 text-amber-600 border-amber-200'
    return 'bg-blue-50 text-blue-600 border-blue-200'
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
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#e7f6ef] font-sans text-slate-800" >
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div>
          <h1 className="text-2xl font-bold text-[#0e7a54] mb-1">قائمة مهامي التحصيلية</h1>
          <p className="text-slate-500 text-sm">
            المحصل: <span className="font-bold text-[#0e7a54]">{profile.full_name ?? 'غير محدد'}</span> — {new Date().toLocaleDateString('ar-SA', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-white rounded-2xl border border-slate-100 p-5 flex items-center justify-between shadow-sm hover:shadow-md transition-shadow">
            <div>
              <div className="text-slate-500 text-xs font-bold mb-1">{stat.label}</div>
              <div className="text-3xl font-bold text-[#0e7a54] font-mono">{stat.value}</div>
            </div>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${stat.bg} ${stat.color}`}>
              <stat.icon size={22} />
            </div>
          </div>
        ))}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        
        {/* Today's Actions */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 flex flex-col shadow-sm">
          <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center">
                <Clock size={20} />
              </div>
              <h2 className="text-lg font-bold text-[#0e7a54]">إجراءات اليوم المستحقة</h2>
            </div>
            <Link href="/dashboard/collector/actions" className="text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
              عرض الكل <ArrowLeft size={14} />
            </Link>
          </div>

          <div className="space-y-3 flex-1">
            {(todayActions ?? []).length === 0 ? (
              <div className="bg-slate-50 rounded-xl p-8 text-center border border-slate-100">
                <div className="w-16 h-16 bg-slate-200/50 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                  <CheckCircle size={24} />
                </div>
                <div className="text-slate-500 font-bold text-sm">لا توجد مهام أو إجراءات مجدولة لليوم</div>
              </div>
            ) : (todayActions ?? []).map((action) => {
              const ActionIcon = actionTypeIcons[action.action_type] || FileText
              const iconColorClass = action.action_type === 'whatsapp' ? 'text-emerald-500 bg-emerald-50' : action.action_type === 'call' ? 'text-blue-500 bg-blue-50' : 'text-slate-500 bg-slate-100'
              
              return (
                <div key={action.id} className="flex items-start gap-4 p-4 bg-white border border-slate-100 rounded-xl hover:border-blue-200 hover:shadow-sm transition-all group">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconColorClass}`}>
                    <ActionIcon size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-[#0e7a54]">{(action.customer as {full_name?: string} | null)?.full_name}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${getPriorityStyle(action.priority)}`}>
                        {getPriorityLabel(action.priority)}
                      </span>
                    </div>
                    <div className="text-slate-500 text-xs mt-1 leading-relaxed bg-[#fcfdfd] border border-slate-50 p-2 rounded-lg">{action.reason}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Assigned debts */}
        <div className="bg-white border border-slate-100 rounded-2xl p-6 flex flex-col shadow-sm">
          <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center">
                <AlertTriangle size={20} />
              </div>
              <h2 className="text-lg font-bold text-[#0e7a54]">أعلى ملفات الديون الأولوية</h2>
            </div>
            <Link href="/dashboard/collector/debts" className="text-xs font-bold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
              عرض الكل <ArrowLeft size={14} />
            </Link>
          </div>

          <div className="space-y-3 flex-1">
            {sortedDebts.length === 0 ? (
              <div className="bg-slate-50 rounded-xl p-8 text-center border border-slate-100">
                <div className="w-16 h-16 bg-slate-200/50 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                  <Wallet size={24} />
                </div>
                <div className="text-slate-500 font-bold text-sm">لا توجد ديون مسندة لك حالياً</div>
              </div>
            ) : sortedDebts.slice(0, 5).map((debt) => (
              <div key={debt.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl hover:border-amber-200 hover:shadow-sm transition-all group">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-[#0e7a54] mb-1">{(debt.customer as {full_name?: string} | null)?.full_name}</div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-400 font-bold bg-slate-50 px-2 py-0.5 rounded">{debt.reference_number}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#e7f6ef] text-slate-500">
                      {getStatusLabel(debt.status)}
                    </span>
                  </div>
                </div>
                <div className="text-end flex flex-col items-end">
                  <div className="text-sm font-bold text-[#0e7a54] font-mono mb-1 bg-green-50 text-green-700 px-2 py-0.5 rounded-lg">
                    {formatCurrency(debt.current_balance, debt.currency)}
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border inline-block ${getPriorityStyle(debt.priority)}`}>
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
