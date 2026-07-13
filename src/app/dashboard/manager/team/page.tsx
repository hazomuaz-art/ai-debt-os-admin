import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import { Users, Mail, TrendingUp, Briefcase } from 'lucide-react'

export default async function ManagerTeamPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || !['admin', 'manager'].includes(profile.role)) redirect('/dashboard/collector')

  const { data: collectors } = await supabase
    .from('profiles')
    .select('*')
    .eq('company_id', profile.company_id)
    .eq('role', 'collector')

  // For each collector, get stats
  const collectorStats = await Promise.all(
    (collectors ?? []).map(async (c) => {
      const { data: assigned } = await supabase
        .from('debts')
        .select('id, current_balance, currency, status')
        .eq('assigned_to', c.id)

      const totalAssigned = assigned?.length ?? 0
      const settled = assigned?.filter(d => d.status === 'settled').length ?? 0
      const totalBalance = assigned?.reduce((s, d) => s + Number(d.current_balance), 0) ?? 0

      return { ...c, totalAssigned, settled, totalBalance }
    })
  )

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">فريق العمل (المحصلون)</h1>
            <p className="text-[#8b95a7] text-sm">متابعة وإدارة أداء محصلي الديون في شركتك.</p>
          </div>
        </div>
      </div>

      {collectorStats.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {collectorStats.map((c) => {
            const progress = c.totalAssigned > 0 ? Math.round((c.settled / c.totalAssigned) * 100) : 0
            return (
              <div key={c.id} className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
                <div className="p-6 border-b border-slate-50 flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 bg-gradient-to-br from-[#0e7a54] to-slate-600 text-white rounded-2xl flex items-center justify-center text-xl font-bold shadow-sm shrink-0">
                      {c.full_name?.charAt(0) ?? '?'}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-lg">{c.full_name ?? 'بدون اسم'}</h3>
                      <div className="flex items-center gap-1.5 text-[#5f6b7e] text-xs mt-1 font-mono">
                        <Mail size={12} /> {c.email}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 grid grid-cols-3 gap-4 bg-[#0d1117] flex-1">
                  <div className="bg-[#151a23] border border-[#222a36] rounded-xl p-3 text-center">
                    <div className="w-6 h-6 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mx-auto mb-2">
                      <Briefcase size={12} />
                    </div>
                    <p className="text-xl font-bold text-white font-mono">{c.totalAssigned}</p>
                    <p className="text-[10px] font-bold text-[#5f6b7e] mt-1">ملف مسند</p>
                  </div>

                  <div className="bg-[#151a23] border border-[#222a36] rounded-xl p-3 text-center">
                    <div className="w-6 h-6 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-2">
                      <TrendingUp size={12} />
                    </div>
                    <p className="text-xl font-bold text-emerald-600 font-mono">{c.settled}</p>
                    <p className="text-[10px] font-bold text-[#5f6b7e] mt-1">مُغلق بنجاح</p>
                  </div>

                  <div className="bg-[#151a23] border border-[#222a36] rounded-xl p-3 text-center">
                    <div className="w-6 h-6 bg-[#222a36] text-[#8b95a7] rounded-full flex items-center justify-center mx-auto mb-2">
                      <span className="font-bold text-[10px]">SAR</span>
                    </div>
                    <p className="text-sm font-bold text-white font-mono truncate px-1 mt-1.5">{formatCurrency(c.totalBalance, 'SAR')}</p>
                    <p className="text-[10px] font-bold text-[#5f6b7e] mt-1">إجمالي المحفظة</p>
                  </div>
                </div>

                <div className="p-6 border-t border-slate-50 bg-[#151a23]">
                  <div className="flex justify-between text-xs font-bold mb-2">
                    <span className="text-white">معدل الإنجاز (التحصيل)</span>
                    <span className="text-blue-600 font-mono">{progress}%</span>
                  </div>
                  <div className="w-full bg-[#222a36] rounded-full h-2 shadow-inner">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-16 text-center">
          <div className="w-20 h-20 bg-[#222a36] text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users size={40} />
          </div>
          <div className="font-bold text-xl text-white mb-2">لا يوجد محصلون في فريقك حالياً</div>
          <p className="text-[#8b95a7] text-sm">قم بدعوة الموظفين للنظام وتعيين دور (محصل) لهم ليظهروا هنا.</p>
        </div>
      )}
    </div>
  )
}
