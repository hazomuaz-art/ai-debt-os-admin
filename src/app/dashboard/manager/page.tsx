import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import { Wallet, Users, CheckCircle, Trophy, BarChart2 } from 'lucide-react'

export default async function ManagerDashboard() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role, full_name')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || !['admin', 'manager'].includes(profile.role)) redirect('/dashboard/collector')

  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const today = new Date().toISOString().split('T')[0]

  const { data: collectors } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('company_id', profile.company_id)
    .eq('role', 'collector')

  const collectorStats = await Promise.all((collectors ?? []).map(async col => {
    const [
      { count: assigned },
      { data: payments },
      { count: actionsToday },
    ] = await Promise.all([
      supabase.from('debts').select('*', { count: 'exact', head: true }).eq('assigned_to', col.id).neq('status', 'settled'),
      supabase.from('payments').select('amount').eq('recorded_by', col.id).gte('payment_date', monthStart),
      supabase.from('ai_actions').select('*', { count: 'exact', head: true }).eq('assigned_to', col.id).eq('scheduled_for', today).eq('status', 'completed'),
    ])
    return {
      ...col,
      assigned: assigned ?? 0,
      collected: payments?.reduce((s, p) => s + p.amount, 0) ?? 0,
      actionsToday: actionsToday ?? 0,
    }
  }))

  const [
    { count: totalDebts },
    { data: balances },
    { data: monthPayments },
  ] = await Promise.all([
    supabase.from('debts').select('*', { count: 'exact', head: true }).eq('company_id', profile.company_id),
    supabase.from('debts').select('current_balance').eq('company_id', profile.company_id).neq('status', 'settled'),
    supabase.from('payments').select('amount').eq('company_id', profile.company_id).gte('payment_date', monthStart),
  ])

  const totalBalance = (balances ?? []).reduce((s, d) => s + Number(d.current_balance ?? 0), 0)
  const totalCollected = (monthPayments ?? []).reduce((s, p) => s + Number(p.amount ?? 0), 0)

  const stats = [
    { 
      title: 'إجمالي المحفظة', 
      value: formatCurrency(totalBalance, 'SAR'), 
      icon: Wallet, 
      color: 'text-blue-400', 
      bg: 'bg-blue-400/10',
      subtitle: `${totalDebts} مطالبة نشطة`
    },
    { 
      title: 'المحصل (هذا الشهر)', 
      value: formatCurrency(totalCollected, 'SAR'), 
      icon: Trophy, 
      color: 'text-emerald-400', 
      bg: 'bg-emerald-400/10',
      subtitle: 'تحصيل فريق العمل'
    },
    { 
      title: 'وكلاء التحصيل النشطين', 
      value: String(collectors?.length ?? 0), 
      icon: Users, 
      color: 'text-purple-400', 
      bg: 'bg-purple-400/10',
      subtitle: 'أعضاء الفريق النشطين'
    },
  ]

  return (
    <div className="space-y-8 animate-in" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-50">لوحة تحكم المدير</h1>
        <p className="text-slate-400 text-xs mt-1">نظرة عامة على أداء فريق العمل ومعدلات التحصيل الحية.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
              <p className="text-2xl font-bold text-slate-50 font-display">{stat.value}</p>
              <span className="text-[10px] text-slate-500 block mt-1 font-medium">{stat.subtitle}</span>
            </div>
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent to-transparent group-hover:from-blue-500 group-hover:to-purple-500 transition-all opacity-0 group-hover:opacity-100"></div>
          </div>
        ))}
      </div>

      {/* Collector performance */}
      <div className="bg-slate-900/40 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden flex flex-col shadow-card">
        <div className="p-5 border-b border-white/5 flex justify-between items-center bg-slate-950/20">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
            <h2 className="text-sm font-semibold text-slate-200 font-display">مراقبة أداء المحصلين وفريق العمل</h2>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right border-collapse">
            <thead className="bg-slate-950/40 text-slate-400 border-b border-white/5">
              <tr>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider">المحصل</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-center">الملفات المسندة</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-center">التحصيل (هذا الشهر)</th>
                <th className="px-6 py-4 font-semibold uppercase tracking-wider text-left pl-6">إجراءات اليوم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {collectorStats.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    لا يوجد محصلون مسجلون حالياً
                  </td>
                </tr>
              ) : (
                collectorStats.sort((a, b) => b.collected - a.collected).map(col => (
                  <tr key={col.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-gradient-brand rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-sm shrink-0">
                          {col.full_name?.charAt(0) ?? '?'}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-200">{col.full_name ?? 'بدون اسم'}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{col.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-3.5 text-center font-mono font-medium text-slate-300">{col.assigned}</td>
                    <td className="px-6 py-3.5 text-center text-emerald-400 font-mono font-bold">{formatCurrency(col.collected, 'SAR')}</td>
                    <td className="px-6 py-3.5 text-left pl-6 font-mono text-brand-400 font-semibold">{col.actionsToday}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
