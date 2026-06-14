import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { 
  Wallet, BrainCircuit, CheckCircle, AlertTriangle, 
  Activity, Clock, MessageCircle, FileText, ArrowLeftRight, Package
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

  const stats = [
    { title: 'إجمالي المحصل (هذا الشهر)', value: formatCurrency(s.totalCollected, 'SAR'), icon: Wallet, color: 'text-emerald-500', bg: 'bg-emerald-50 border-emerald-100' },
    { title: 'رسائل AI اليومية', value: String(s.messagesToday || s.aiActionsToday || 0), icon: BrainCircuit, color: 'text-blue-500', bg: 'bg-blue-50 border-blue-100' },
    { title: 'وعود السداد', value: String(s.statusCount['promised'] ?? 0), icon: CheckCircle, color: 'text-purple-500', bg: 'bg-purple-50 border-purple-100' },
    { title: 'مطالبات متأخرة (تتطلب تدخلاً)', value: String(s.overdueDebts ?? 0), icon: AlertTriangle, color: 'text-rose-500', bg: 'bg-rose-50 border-rose-200', isAlert: true },
  ];

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" >
      
      {/* Overview Section */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mt-6">
        <h2 className="text-xl font-bold text-[#1e3e50] mb-6">نظرة عامة</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat, i) => (
            <div key={i} className={`border p-5 rounded-2xl flex items-center gap-4 transition-all duration-200 hover:shadow-md ${stat.isAlert ? 'bg-[#fff5f5] border-rose-100' : 'bg-white border-slate-100'}`}>
              <div className={`p-4 rounded-xl shrink-0 ${stat.bg} ${stat.color}`}>
                <stat.icon size={28} strokeWidth={2.5} />
              </div>
              <div>
                <div className={`text-2xl font-bold font-mono ${stat.isAlert ? 'text-rose-700' : 'text-[#1e3e50]'}`}>{stat.value}</div>
                <div className={`text-sm mt-1 ${stat.isAlert ? 'text-rose-600 font-bold' : 'text-slate-500 font-medium'}`}>{stat.title}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Grid Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column */}
        <div className="col-span-1 space-y-6">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center items-center text-center hover:shadow-md transition-shadow">
            <div className="flex justify-between w-full mb-4 px-2">
              <h3 className="font-bold text-[#1e3e50] text-lg">قاعدة العملاء</h3>
            </div>
            <div className="bg-[#e6f0f9] p-4 rounded-full mb-4">
              <Activity className="text-[#1e3e50]" size={28} />
            </div>
            <div className="text-4xl font-bold text-[#1e3e50] font-mono">{s.activeCustomers}</div>
            <div className="text-sm font-bold text-slate-500 mt-2">عميل مسجل ونشط</div>
          </div>
          
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col justify-center hover:shadow-md transition-shadow">
             <h3 className="font-bold text-[#1e3e50] text-lg mb-6 text-center">أداء المحفظة</h3>
             <div className="flex justify-center items-center gap-8">
               <div className="w-28 h-28 rounded-full border-[14px] border-[#1e3e50] border-t-[#a3c1e0] relative flex justify-center items-center shadow-inner">
                  <span className="text-sm font-bold text-slate-500">68%</span>
               </div>
               <div className="space-y-4">
                 <div className="flex items-center gap-3 text-sm text-[#1e3e50] font-bold">
                   <div className="w-4 h-4 bg-[#a3c1e0] rounded-sm shadow-sm"></div>
                   تم تحصيله
                 </div>
                 <div className="flex items-center gap-3 text-sm text-[#1e3e50] font-bold">
                   <div className="w-4 h-4 bg-[#1e3e50] rounded-sm shadow-sm"></div>
                   المتبقي
                 </div>
               </div>
             </div>
          </div>
        </div>

        {/* Middle Column (Live Feed) */}
        <div className="col-span-1 lg:col-span-2 bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm flex flex-col hover:shadow-md transition-shadow">
          <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white">
            <h2 className="text-lg font-bold text-[#1e3e50] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
              العمليات اللحظية (Live Feed)
            </h2>
            <button className="text-sm text-blue-600 hover:text-blue-700 font-bold bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-xl transition-colors">عرض السجل الكامل</button>
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
                      <td className="px-5 py-4 text-sm font-bold text-[#1e3e50]">{clientName}</td>
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

      </div>
    </div>
  )
}
