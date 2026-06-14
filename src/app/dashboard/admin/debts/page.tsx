import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { CreateDebtModal } from '@/components/debt/CreateDebtModal'
import ImportDebtsModal from '@/components/debt/ImportDebtsModal'
import ExportDebtsButton from '@/components/debt/ExportDebtsButton'
import Link from 'next/link'
import { WalletCards } from 'lucide-react'
import DebtFilters from '@/components/debt/DebtFilters'

// Helper function for Light Theme Status Colors
function getLightStatusColor(status: string) {
  switch (status?.toLowerCase()) {
    case 'active':         return 'bg-blue-50 text-blue-600 border-blue-200'
    case 'in_progress':    return 'bg-yellow-50 text-yellow-600 border-yellow-200'
    case 'in_negotiation': return 'bg-yellow-50 text-yellow-600 border-yellow-200'
    case 'payment_plan':   return 'bg-cyan-50 text-cyan-600 border-cyan-200'
    case 'promised':       return 'bg-purple-50 text-purple-600 border-purple-200'
    case 'partial':        return 'bg-orange-50 text-orange-600 border-orange-200'
    case 'settled':        return 'bg-emerald-50 text-emerald-600 border-emerald-200'
    case 'legal':          return 'bg-red-50 text-red-600 border-red-200'
    case 'disputed':       return 'bg-rose-50 text-rose-600 border-rose-200'
    case 'written_off':    return 'bg-slate-100 text-slate-600 border-slate-200'
    default:               return 'bg-slate-50 text-slate-500 border-slate-200'
  }
}

export default async function AdminDebtsPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) redirect('/login')

  const page = parseInt(searchParams.page ?? '1')
  const limit = 20
  const offset = (page - 1) * limit

  let query = supabase
    .from('debts')
    .select(`
      *,
      customer:customers(id, full_name, phone),
      assigned_collector:profiles!debts_assigned_to_fkey(id, full_name),
      ai_scores(score, risk_classification)
    `, { count: 'exact' })
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (searchParams.status) query = query.eq('status', searchParams.status)
  if (searchParams.product) query = query.eq('product_type', searchParams.product)
  if (searchParams.creditor) query = query.eq('creditor_name', searchParams.creditor)
  
  if (searchParams.collector) {
    if (searchParams.collector === 'unassigned') {
      query = query.is('assigned_to', null)
    } else {
      query = query.eq('assigned_to', searchParams.collector)
    }
  }

  if (searchParams.q) {
    // Search by reference_number or account_number
    query = query.or(`reference_number.ilike.%${searchParams.q}%,account_number.ilike.%${searchParams.q}%`)
  }

  const { data: debts, count } = await query
  const totalPages = Math.ceil((count ?? 0) / limit)

  // Fetch filter options (collectors, unique products, unique creditors)
  const [
    { data: collectorsData },
    { data: productsData },
    { data: creditorsData }
  ] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('role', ['manager', 'collector']),
    supabase.from('debts').select('product_type').neq('product_type', null),
    supabase.from('debts').select('creditor_name').neq('creditor_name', null)
  ])

  const productTypes = Array.from(new Set((productsData || []).map(p => p.product_type)))
  const creditors = Array.from(new Set((creditorsData || []).map(c => c.creditor_name)))

  const statuses = ['active', 'in_progress', 'promised', 'partial', 'settled', 'legal', 'disputed', 'written_off']

  const statusLabels: Record<string, string> = {
    active: 'نشط', in_progress: 'قيد التنفيذ', promised: 'وعود سداد',
    partial: 'سداد جزئي', settled: 'مُسدد', written_off: 'معدوم',
    legal: 'إجراء قانوني', disputed: 'متنازع عليه',
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" >
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#e6f0f9] text-[#1e3e50] rounded-xl flex items-center justify-center shrink-0">
            <WalletCards size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">الديون والمطالبات</h1>
            <p className="text-slate-500 text-sm">إجمالي الديون المسجلة: <span className="font-bold text-[#1e3e50]">{count ?? 0}</span></p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportDebtsButton status={searchParams.status} />
          <ImportDebtsModal />
          <CreateDebtModal />
        </div>
      </div>

      {/* Advanced Filters */}
      <DebtFilters 
        collectors={collectorsData || []} 
        creditors={creditors} 
        productTypes={productTypes} 
      />

      {/* Debts Table */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#fbfdfd] border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-start font-bold text-[#1e3e50]">رقم المرجع</th>
                <th className="px-6 py-4 text-start font-bold text-[#1e3e50]">العميل</th>
                <th className="px-6 py-4 text-start font-bold text-[#1e3e50]">المبلغ المستحق</th>
                <th className="px-6 py-4 text-center font-bold text-[#1e3e50]">الحالة</th>
                <th className="px-6 py-4 text-center font-bold text-[#1e3e50]">تقييم الذكاء الاصطناعي</th>
                <th className="px-6 py-4 text-start font-bold text-[#1e3e50]">المسؤول (المحصل)</th>
                <th className="px-6 py-4 text-start font-bold text-[#1e3e50]">تاريخ الاستحقاق</th>
                <th className="px-6 py-4 text-center font-bold text-[#1e3e50]">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(debts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                    لا توجد ديون. قم بإضافة الدين الأول للبدء.
                  </td>
                </tr>
              ) : (debts ?? []).map((debt: any) => {
                const latestScore = debt.ai_scores?.[0]
                return (
                  <tr key={debt.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md border border-blue-100">{debt.reference_number}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-[#1e3e50]">{debt.customer?.full_name ?? '—'}</div>
                      <div className="text-slate-400 text-xs mt-0.5">{debt.customer?.phone ?? ''}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-rose-600">{formatCurrency(debt.current_balance, debt.currency)}</div>
                      <div className="text-slate-400 text-xs mt-0.5">من {formatCurrency(debt.original_amount, debt.currency)}</div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${getLightStatusColor(debt.status)}`}>
                        {statusLabels[debt.status] ?? debt.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {latestScore ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <div className={`w-2.5 h-2.5 rounded-full shadow-sm ${latestScore.score! >= 70 ? 'bg-emerald-400' : latestScore.score! >= 40 ? 'bg-amber-400' : 'bg-rose-400'}`} />
                          <span className="font-mono font-bold text-[#1e3e50]">{latestScore.score}</span>
                        </div>
                      ) : (
                        <span className="text-slate-300 font-bold">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-600 bg-slate-50 px-2 py-1 rounded-md">{debt.assigned_collector?.full_name ?? 'غير معين'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-500 font-mono">{debt.due_date ? formatDate(debt.due_date) : '—'}</span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <Link href={`/dashboard/admin/debts/${debt.id}`} className="inline-block px-4 py-1.5 bg-white border border-slate-200 text-[#1e3e50] hover:bg-slate-50 font-bold rounded-lg text-xs transition-colors shadow-sm">
                        عرض التفاصيل
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-[#fbfdfd]">
            <span className="text-slate-500 text-sm font-medium">
              صفحة <span className="font-bold text-[#1e3e50]">{page}</span> من <span className="font-bold text-[#1e3e50]">{totalPages}</span>
            </span>
            <div className="flex gap-2">
              {page < totalPages && (
                <Link href={`/dashboard/admin/debts?page=${page + 1}${searchParams.status ? `&status=${searchParams.status}` : ''}`} className="px-4 py-2 bg-white border border-slate-200 text-[#1e3e50] hover:bg-slate-50 font-bold rounded-xl text-sm transition-colors shadow-sm">
                  التالي ←
                </Link>
              )}
              {page > 1 && (
                <Link href={`/dashboard/admin/debts?page=${page - 1}${searchParams.status ? `&status=${searchParams.status}` : ''}`} className="px-4 py-2 bg-white border border-slate-200 text-[#1e3e50] hover:bg-slate-50 font-bold rounded-xl text-sm transition-colors shadow-sm">
                  → السابق
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
