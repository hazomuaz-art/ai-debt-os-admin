import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Wallet, Search, Filter, ArrowLeft, ArrowUpRight, ArrowDownRight, Clock, ShieldAlert } from 'lucide-react'
import DebtFilters from '@/components/debt/DebtFilters'

export default async function CollectorDebtsPage(
  props: {
    searchParams: Promise<{ status?: string; page?: string; q?: string; product?: string; creditor?: string }>
  }
) {
  const searchParams = await props.searchParams;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let query = supabase
    .from('debts')
    .select('*, customer:customers(full_name, phone, whatsapp)', { count: 'exact' })
    .eq('assigned_to', user.id)
    .order('priority', { ascending: false })
    .order('due_date', { ascending: true })

  if (searchParams.status) query = query.eq('status', searchParams.status)
  if (searchParams.product) query = query.eq('product_type', searchParams.product)
  if (searchParams.creditor) query = query.eq('creditor_name', searchParams.creditor)

  if (searchParams.q) {
    query = query.or(`reference_number.ilike.%${searchParams.q}%,account_number.ilike.%${searchParams.q}%`)
  }

  const { data: debts, count } = await query

  // Fetch filter options
  const [
    { data: productsData },
    { data: creditorsData }
  ] = await Promise.all([
    supabase.from('debts').select('product_type').neq('product_type', null).eq('assigned_to', user.id),
    supabase.from('debts').select('creditor_name').neq('creditor_name', null).eq('assigned_to', user.id)
  ])

  const productTypes: string[] = Array.from(new Set((productsData || []).map((p: any) => String(p.product_type))))
  const creditors: string[] = Array.from(new Set((creditorsData || []).map((c: any) => String(c.creditor_name))))

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
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
            <Wallet size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">ملفات الديون</h1>
            <p className="text-[#8b95a7] text-sm font-medium">إجمالي {count ?? 0} ملف مسند إليك بقيمة {formatCurrency(totalBalance, 'SAR')}</p>
          </div>
        </div>
      </div>

      <DebtFilters 
        collectors={[]} 
        creditors={creditors} 
        productTypes={productTypes} 
      />

      {/* Debts List */}
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#0d1117] border-b border-[#222a36] text-[#8b95a7]">
              <tr>
                <th className="px-6 py-4 font-bold">العميل</th>
                <th className="px-6 py-4 font-bold">رصيد المديونية</th>
                <th className="px-6 py-4 font-bold text-center">الحالة</th>
                <th className="px-6 py-4 font-bold text-center">الأولوية</th>
                <th className="px-6 py-4 font-bold">تاريخ الاستحقاق</th>
                <th className="px-6 py-4 font-bold text-center">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {(debts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center">
                    <div className="w-16 h-16 bg-[#222a36] text-slate-300 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Wallet size={24} />
                    </div>
                    <div className="text-[#8b95a7] font-bold">لا توجد ديون مسندة لك بعد</div>
                  </td>
                </tr>
              ) : (debts ?? []).map(debt => (
                <tr key={debt.id} className="hover:bg-[#1a212c] transition-colors group">
                  <td className="px-6 py-4">
                    <div className="font-bold text-white text-sm mb-1">{(debt.customer as {full_name?: string} | null)?.full_name ?? 'غير معروف'}</div>
                    <div className="text-[#5f6b7e] text-xs font-mono" dir="ltr">{(debt.customer as {phone?: string} | null)?.phone ?? '—'}</div>
                  </td>
                  
                  <td className="px-6 py-4">
                    <div className="font-bold text-white font-mono text-base">{formatCurrency(debt.current_balance, debt.currency)}</div>
                    <div className="text-[#5f6b7e] text-xs mt-0.5">من أصل {formatCurrency(debt.original_amount, debt.currency)}</div>
                  </td>
                  
                  <td className="px-6 py-4 text-center">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#0b0e14] text-slate-300">
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
                    <div className="flex items-center gap-1.5 text-slate-300 font-medium">
                      <Clock size={14} className="text-[#5f6b7e]" />
                      {debt.due_date ? formatDate(debt.due_date) : '—'}
                    </div>
                  </td>
                  
                  <td className="px-6 py-4 text-center">
                    <Link href={`/dashboard/collector/debts/${debt.id}`} 
                      className="inline-flex items-center gap-1 bg-[#151a23] border border-[#222a36] text-blue-600 hover:text-blue-700 hover:bg-blue-50 hover:border-blue-200 text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm group-hover:shadow">
                      التفاصيل <ArrowLeft size={14} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {/* Pagination placeholder if needed */}
        <div className="bg-[#0d1117] border-t border-[#222a36] p-4 flex items-center justify-between text-sm text-[#8b95a7] font-medium">
          <div>عرض 1 إلى {(debts ?? []).length} من أصل {count ?? 0} ملف</div>
          <div className="flex gap-2">
            <button disabled className="px-3 py-1.5 border border-[#222a36] rounded-lg opacity-50 bg-[#222a36]">السابق</button>
            <button disabled className="px-3 py-1.5 border border-[#222a36] rounded-lg opacity-50 bg-[#222a36]">التالي</button>
          </div>
        </div>
      </div>
    </div>
  )
}
