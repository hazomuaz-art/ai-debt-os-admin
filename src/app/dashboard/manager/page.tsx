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
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">لوحة تحكم المدير</h1>
          <p className="text-[#8b95a7] text-sm">نظرة عامة على أداء فريق العمل ومعدلات التحصيل الحية.</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, idx) => (
          <div 
            key={idx} 
            className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${stat.bg} ${stat.color} shadow-sm`}>
              <stat.icon size={22} />
            </div>
            <div>
              <h3 className="text-[#8b95a7] text-xs font-bold mb-1 uppercase tracking-wide">{stat.title}</h3>
              <p className="text-3xl font-bold text-white font-mono">{stat.value}</p>
              <span className="text-[11px] text-[#5f6b7e] block mt-1 font-bold">{stat.subtitle}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Collector performance */}
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden flex flex-col shadow-sm">
        <div className="p-6 border-b border-[#222a36] flex justify-between items-center bg-[#0d1117]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
              <Users size={20} />
            </div>
            <h2 className="text-lg font-bold text-white">مراقبة أداء المحصلين وفريق العمل</h2>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start border-collapse">
            <thead className="bg-[#0b0e14] text-[#8b95a7] border-b border-[#222a36]">
              <tr>
                <th className="px-6 py-4 font-bold uppercase tracking-wider">المحصل</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-center">الملفات المسندة</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-center">التحصيل (هذا الشهر)</th>
                <th className="px-6 py-4 font-bold uppercase tracking-wider text-end ps-6">إجراءات اليوم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {collectorStats.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-[#5f6b7e] font-bold bg-[#222a36]">
                    لا يوجد محصلون مسجلون حالياً
                  </td>
                </tr>
              ) : (
                collectorStats.sort((a, b) => b.collected - a.collected).map(col => (
                  <tr key={col.id} className="hover:bg-[#1a212c] transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#0d1117] text-white rounded-xl flex items-center justify-center text-sm font-bold shadow-sm shrink-0">
                          {col.full_name?.charAt(0) ?? '?'}
                        </div>
                        <div>
                          <div className="font-bold text-white">{col.full_name ?? 'بدون اسم'}</div>
                          <div className="text-[11px] text-[#8b95a7] mt-0.5 font-mono">{col.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center font-mono font-bold text-white bg-[#222a36]/50">{col.assigned}</td>
                    <td className="px-6 py-4 text-center text-emerald-600 font-mono font-bold">{formatCurrency(col.collected, 'SAR')}</td>
                    <td className="px-6 py-4 text-end ps-6 font-mono text-purple-600 font-bold bg-[#222a36]/50">{col.actionsToday}</td>
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
