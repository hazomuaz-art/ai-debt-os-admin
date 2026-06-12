import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Wallet, Search, Filter, ArrowLeft, ArrowUpRight, ArrowDownRight, Clock, ShieldAlert } from 'lucide-react'

export default async function CollectorDebtsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: debts, count } = await supabase
    .from('debts')
    .select('*, customer:customers(full_name, phone, whatsapp)', { count: 'exact' })
    .eq('assigned_to', user.id)
    .order('priority', { ascending: false })
    .order('due_date', { ascending: true })

  const getPriorityStyle = (p: string) => {
    if (p === 'critical' || p === 'high') return 'bg-rose-50 text-rose-600 border-rose-200'
    if (p === 'medium') return 'bg-amber-50 text-amber-600 border-amber-200'
    return 'bg-blue-50 text-blue-600 border-blue-200'
  }

  const getStatusLabel = (s: string) => {
    const labels: Record<string, string> = {
      active: 'نشط', promised: 'وعد سداد', disputed: 'معترض', partial: 'سداد جزئي', settled: 'مسدد بالكامل'
    }
    return labels[s] ?? s
  }

  const getPriorityLabel = (p: string) => {
    const labels: Record<string, string> = {
      critical: 'حرج جداً', high: 'مرتفع', medium: 'متوسط', low: 'منخفض'
    }
    return labels[p] ?? p
  }

  const totalBalance = (debts ?? []).reduce((s, d) => s + Number(d.current_balance ?? 0), 0)

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
            <Wallet size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">ملفات الديون</h1>
            <p className="text-slate-500 text-sm font-medium">إجمالي {count ?? 0} ملف مسند إليك بقيمة {formatCurrency(totalBalance, 'SAR')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:flex-none">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              className="w-full md:w-64 bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl pr-10 pl-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-slate-400"
              placeholder="ابحث برقم الهوية، الاسم أو الجوال..."
            />
          </div>
          <button className="bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 p-2.5 rounded-xl transition-colors shadow-sm">
            <Filter size={18} />
          </button>
        </div>
      </div>

      {/* Debts List */}
      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#fbfdfd] border-b border-slate-100 text-slate-500">
              <tr>
                <th className="px-6 py-4 font-bold">العميل</th>
                <th className="px-6 py-4 font-bold">رصيد المديونية</th>
                <th className="px-6 py-4 font-bold text-center">الحالة</th>
                <th className="px-6 py-4 font-bold text-center">الأولوية</th>
                <th className="px-6 py-4 font-bold">تاريخ الاستحقاق</th>
                <th className="px-6 py-4 font-bold text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(debts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Wallet size={24} />
                    </div>
                    <div className="text-slate-500 font-bold">لا توجد ديون مسندة لك بعد</div>
                  </td>
                </tr>
              ) : (debts ?? []).map(debt => (
                <tr key={debt.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-bold text-[#1e3e50] text-sm mb-1">{(debt.customer as {full_name?: string} | null)?.full_name ?? 'غير معروف'}</div>
                    <div className="text-slate-400 text-xs font-mono" dir="ltr">{(debt.customer as {phone?: string} | null)?.phone ?? '—'}</div>
                  </td>
                  
                  <td className="px-6 py-4">
                    <div className="font-bold text-[#1e3e50] font-mono text-base">{formatCurrency(debt.current_balance, debt.currency)}</div>
                    <div className="text-slate-400 text-xs mt-0.5">من أصل {formatCurrency(debt.original_amount, debt.currency)}</div>
                  </td>
                  
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#f0f4f8] text-slate-600">
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        debt.status === 'active' ? 'bg-blue-500' :
                        debt.status === 'promised' ? 'bg-amber-500' :
                        debt.status === 'settled' ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}></span>
                      {getStatusLabel(debt.status)}
                    </span>
                  </td>
                  
                  <td className="px-6 py-4 text-center">
                    <span className={`inline-block px-2.5 py-1 rounded-md text-[11px] font-bold border ${getPriorityStyle(debt.priority)}`}>
                      {getPriorityLabel(debt.priority)}
                    </span>
                  </td>
                  
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                      <Clock size={14} className="text-slate-400" />
                      {debt.due_date ? formatDate(debt.due_date) : '—'}
                    </div>
                  </td>
                  
                  <td className="px-6 py-4 text-center">
                    <Link href={`/dashboard/collector/debts/${debt.id}`} 
                      className="inline-flex items-center gap-1 bg-white border border-slate-200 text-blue-600 hover:text-blue-700 hover:bg-blue-50 hover:border-blue-200 text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm group-hover:shadow">
                      التفاصيل <ArrowLeft size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Pagination placeholder if needed */}
        <div className="bg-[#fbfdfd] border-t border-slate-100 p-4 flex items-center justify-between text-sm text-slate-500 font-medium">
          <div>عرض 1 إلى {(debts ?? []).length} من أصل {count ?? 0} ملف</div>
          <div className="flex gap-2">
            <button disabled className="px-3 py-1.5 border border-slate-200 rounded-lg opacity-50 bg-slate-50">السابق</button>
            <button disabled className="px-3 py-1.5 border border-slate-200 rounded-lg opacity-50 bg-slate-50">التالي</button>
          </div>
        </div>
      </div>
    </div>
  )
}
