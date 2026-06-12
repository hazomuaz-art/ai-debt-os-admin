import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { CreateCustomerModal } from '@/components/debt/CreateCustomerModal'
import { Users, Search } from 'lucide-react'

// Helper function for Risk Level colors (Light Theme adjusted)
function getRiskColor(risk: string) {
  switch (risk?.toLowerCase()) {
    case 'high': return 'bg-rose-50 text-rose-600 border border-rose-200'
    case 'medium': return 'bg-orange-50 text-orange-600 border border-orange-200'
    case 'low': return 'bg-emerald-50 text-emerald-600 border border-emerald-200'
    default: return 'bg-slate-50 text-slate-600 border border-slate-200'
  }
}

function translateRisk(risk: string) {
  switch (risk?.toLowerCase()) {
    case 'high': return 'مرتفع'
    case 'medium': return 'متوسط'
    case 'low': return 'منخفض'
    default: return 'غير محدد'
  }
}

export default async function AdminCustomersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) redirect('/login')

  const { data: customers, count } = await supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#e6f0f9] text-[#1e3e50] rounded-xl flex items-center justify-center shrink-0">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">إدارة العملاء</h1>
            <p className="text-slate-500 text-sm">إجمالي العملاء المسجلين في النظام: <span className="font-bold text-[#1e3e50]">{count ?? 0}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative hidden md:block">
            <Search className="absolute right-3 top-2.5 text-slate-400" size={18} />
            <input 
              type="text" 
              placeholder="البحث السريع..." 
              className="w-64 bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl pr-10 pl-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#1e3e50]"
            />
          </div>
          <CreateCustomerModal />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#fbfdfd] border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-right font-bold text-[#1e3e50]">اسم العميل</th>
                <th className="px-6 py-4 text-right font-bold text-[#1e3e50]">معلومات التواصل</th>
                <th className="px-6 py-4 text-right font-bold text-[#1e3e50]">الهوية الوطنية / الإقامة</th>
                <th className="px-6 py-4 text-center font-bold text-[#1e3e50]">مستوى الخطورة</th>
                <th className="px-6 py-4 text-right font-bold text-[#1e3e50]">المدينة</th>
                <th className="px-6 py-4 text-right font-bold text-[#1e3e50]">تاريخ الإضافة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(customers ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">لا يوجد عملاء مسجلين حتى الآن.</td>
                </tr>
              ) : (customers ?? []).map(c => (
                <tr key={c.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-[#e6f0f9] rounded-full flex items-center justify-center text-sm font-bold text-[#1e3e50]">
                        {c.full_name?.charAt(0) ?? '?'}
                      </div>
                      <span className="font-semibold text-[#1e3e50]">{c.full_name || 'غير معروف'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-mono text-slate-600 mb-1">{c.phone ?? c.email ?? '—'}</div>
                    {c.whatsapp && <div className="text-xs text-emerald-600 bg-emerald-50 inline-block px-2 py-0.5 rounded-full font-mono">WA: {c.whatsapp}</div>}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">{c.national_id ?? '—'}</span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${getRiskColor(c.risk_level)}`}>
                      {translateRisk(c.risk_level)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-600">
                    {c.city ?? '—'}
                  </td>
                  <td className="px-6 py-4 text-slate-500 text-xs">
                    {formatDate(c.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
    </div>
  )
}
