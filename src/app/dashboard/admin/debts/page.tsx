import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { CreateDebtModal } from '@/components/debt/CreateDebtModal'
import { CreateCustomerModal } from '@/components/debt/CreateCustomerModal'
import ImportDebtsModal from '@/components/debt/ImportDebtsModal'
import ExportDebtsButton from '@/components/debt/ExportDebtsButton'
import Link from 'next/link'
import { WalletCards, Users } from 'lucide-react'
import DebtFilters from '@/components/debt/DebtFilters'

function getStatusColor(status: string) {
  switch (status?.toLowerCase()) {
    case 'active':         return 'bg-blue-500/10 text-blue-400 border-blue-500/20'
    case 'in_progress':    return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    case 'in_negotiation': return 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    case 'payment_plan':   return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
    case 'promised':       return 'bg-purple-500/10 text-purple-400 border-purple-500/20'
    case 'partial':        return 'bg-orange-500/10 text-orange-400 border-orange-500/20'
    case 'settled':        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    case 'legal':          return 'bg-red-500/10 text-red-400 border-red-500/20'
    case 'disputed':       return 'bg-rose-500/10 text-rose-400 border-rose-500/20'
    case 'written_off':    return 'bg-[#222a36] text-[#8b95a7] border-[#2c3543]'
    default:               return 'bg-[#222a36] text-[#8b95a7] border-[#2c3543]'
  }
}

function getRiskColor(risk: string) {
  switch (risk?.toLowerCase()) {
    case 'high':   return 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
    case 'medium': return 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
    case 'low':    return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
    default:       return 'bg-[#222a36] text-[#8b95a7] border border-[#2c3543]'
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

export default async function AdminDebtsPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string; view?: string; product?: string; creditor?: string; collector?: string; q?: string }
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

  const view = searchParams.view === 'customers' ? 'customers' : 'debts'
  const tabBase = '/dashboard/admin/debts'

  const tabs = (
    <div className="inline-flex items-center gap-1 bg-[#151a23] border border-[#222a36] rounded-xl p-1">
      <Link href={tabBase} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${view === 'debts' ? 'bg-[#10b981] text-white' : 'text-[#8b95a7] hover:text-white'}`}>
        <WalletCards size={16} /> الديون
      </Link>
      <Link href={`${tabBase}?view=customers`} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${view === 'customers' ? 'bg-[#10b981] text-white' : 'text-[#8b95a7] hover:text-white'}`}>
        <Users size={16} /> العملاء
      </Link>
    </div>
  )

  // ════════════════ CUSTOMERS VIEW ════════════════
  if (view === 'customers') {
    const { data: customers, count } = await supabase
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })
      .limit(50)

    return (
      <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-200">
        <div className="bg-[#151a23] rounded-2xl p-6 border border-[#222a36] flex items-center justify-between mt-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">العملاء والمديونيات</h1>
            <p className="text-[#8b95a7] text-sm">إجمالي العملاء المسجلين: <span className="font-bold text-emerald-400">{count ?? 0}</span></p>
          </div>
          <div className="flex items-center gap-3">{tabs}<CreateCustomerModal /></div>
        </div>

        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#0d1117] border-b border-[#222a36]">
                <tr>
                  <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">اسم العميل</th>
                  <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">معلومات التواصل</th>
                  <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">الهوية الوطنية</th>
                  <th className="px-6 py-4 text-center font-bold text-[#8b95a7]">مستوى الخطورة</th>
                  <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">المدينة</th>
                  <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">تاريخ الإضافة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1c2330]">
                {(customers ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-[#5f6b7e]">لا يوجد عملاء مسجلين حتى الآن.</td></tr>
                ) : (customers ?? []).map(c => (
                  <tr key={c.id} className="hover:bg-[#1a212c] transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-emerald-500/15 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">{c.full_name?.charAt(0) ?? '?'}</div>
                        <span className="font-semibold text-white">{c.full_name || 'غير معروف'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-slate-300 mb-1">{c.phone ?? c.email ?? '—'}</div>
                      {c.whatsapp && <div className="text-xs text-emerald-400 bg-emerald-500/10 inline-block px-2 py-0.5 rounded-full font-mono">WA: {c.whatsapp}</div>}
                    </td>
                    <td className="px-6 py-4"><span className="font-mono text-[#8b95a7] bg-[#222a36] px-2 py-1 rounded-md border border-[#2c3543]">{c.national_id ?? '—'}</span></td>
                    <td className="px-6 py-4 text-center"><span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${getRiskColor(c.risk_level)}`}>{translateRisk(c.risk_level)}</span></td>
                    <td className="px-6 py-4 text-slate-300">{c.city ?? '—'}</td>
                    <td className="px-6 py-4 text-[#5f6b7e] text-xs">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════ DEBTS VIEW ════════════════
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
    if (searchParams.collector === 'unassigned') query = query.is('assigned_to', null)
    else query = query.eq('assigned_to', searchParams.collector)
  }
  if (searchParams.q) query = query.or(`reference_number.ilike.%${searchParams.q}%,account_number.ilike.%${searchParams.q}%`)

  const { data: debts, count } = await query
  const totalPages = Math.ceil((count ?? 0) / limit)

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

  const statusLabels: Record<string, string> = {
    active: 'نشط', in_progress: 'قيد التنفيذ', promised: 'وعود سداد',
    partial: 'سداد جزئي', settled: 'مُسدد', written_off: 'معدوم',
    legal: 'إجراء قانوني', disputed: 'متنازع عليه', payment_plan: 'خطة تقسيط',
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-200">
      <div className="bg-[#151a23] rounded-2xl p-6 border border-[#222a36] flex items-center justify-between mt-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">العملاء والمديونيات</h1>
          <p className="text-[#8b95a7] text-sm">إجمالي الديون المسجلة: <span className="font-bold text-emerald-400">{count ?? 0}</span></p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {tabs}
          <ExportDebtsButton status={searchParams.status} />
          <ImportDebtsModal />
          <CreateDebtModal />
        </div>
      </div>

      <DebtFilters collectors={collectorsData || []} creditors={creditors} productTypes={productTypes} />

      <div className="bg-[#151a23] rounded-2xl border border-[#222a36] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0d1117] border-b border-[#222a36]">
              <tr>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">رقم المرجع</th>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">العميل</th>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">المبلغ المستحق</th>
                <th className="px-6 py-4 text-center font-bold text-[#8b95a7]">الحالة</th>
                <th className="px-6 py-4 text-center font-bold text-[#8b95a7]">تقييم الذكاء</th>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">المحصّل</th>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">تاريخ الاستحقاق</th>
                <th className="px-6 py-4 text-center font-bold text-[#8b95a7]">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {(debts ?? []).length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-[#5f6b7e]">لا توجد ديون. قم بإضافة الدين الأول للبدء.</td></tr>
              ) : (debts ?? []).map((debt: any) => {
                const latestScore = debt.ai_scores?.[0]
                return (
                  <tr key={debt.id} className="hover:bg-[#1a212c] transition-colors">
                    <td className="px-6 py-4"><span className="font-mono text-sm font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded-md border border-blue-500/20">{debt.reference_number}</span></td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white">{debt.customer?.full_name ?? '—'}</div>
                      <div className="text-[#5f6b7e] text-xs mt-0.5">{debt.customer?.phone ?? ''}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-rose-400">{formatCurrency(debt.current_balance, debt.currency)}</div>
                      <div className="text-[#5f6b7e] text-xs mt-0.5">من {formatCurrency(debt.original_amount, debt.currency)}</div>
                    </td>
                    <td className="px-6 py-4 text-center"><span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusColor(debt.status)}`}>{statusLabels[debt.status] ?? debt.status}</span></td>
                    <td className="px-6 py-4 text-center">
                      {latestScore ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <div className={`w-2.5 h-2.5 rounded-full ${latestScore.score! >= 70 ? 'bg-emerald-400' : latestScore.score! >= 40 ? 'bg-amber-400' : 'bg-rose-400'}`} />
                          <span className="font-mono font-bold text-white">{latestScore.score}</span>
                        </div>
                      ) : <span className="text-[#5f6b7e] font-bold">—</span>}
                    </td>
                    <td className="px-6 py-4"><span className="text-sm font-medium text-slate-300 bg-[#222a36] px-2 py-1 rounded-md">{debt.assigned_collector?.full_name ?? 'غير معين'}</span></td>
                    <td className="px-6 py-4"><span className="text-sm text-[#8b95a7] font-mono">{debt.due_date ? formatDate(debt.due_date) : '—'}</span></td>
                    <td className="px-6 py-4 text-center">
                      <Link href={`/dashboard/admin/debts/${debt.id}`} className="inline-block px-4 py-1.5 bg-[#1a212c] border border-[#2c3543] text-emerald-400 hover:bg-[#222a36] font-bold rounded-lg text-xs transition-colors">عرض التفاصيل</Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-[#222a36] flex items-center justify-between bg-[#0d1117]">
            <span className="text-[#8b95a7] text-sm font-medium">صفحة <span className="font-bold text-white">{page}</span> من <span className="font-bold text-white">{totalPages}</span></span>
            <div className="flex gap-2">
              {page < totalPages && <Link href={`/dashboard/admin/debts?page=${page + 1}${searchParams.status ? `&status=${searchParams.status}` : ''}`} className="px-4 py-2 bg-[#1a212c] border border-[#2c3543] text-emerald-400 hover:bg-[#222a36] font-bold rounded-xl text-sm transition-colors">التالي ←</Link>}
              {page > 1 && <Link href={`/dashboard/admin/debts?page=${page - 1}${searchParams.status ? `&status=${searchParams.status}` : ''}`} className="px-4 py-2 bg-[#1a212c] border border-[#2c3543] text-emerald-400 hover:bg-[#222a36] font-bold rounded-xl text-sm transition-colors">→ السابق</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
