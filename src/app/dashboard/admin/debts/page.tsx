import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { getServerTranslation } from '@/lib/i18n/server'
import { AddCaseModal } from '@/components/debt/AddCaseModal'
import ImportDebtsModal from '@/components/debt/ImportDebtsModal'
import ExportDebtsButton from '@/components/debt/ExportDebtsButton'
import { StartConversationButton } from '@/components/debt/StartConversationButton'
import Link from 'next/link'
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

export default async function AdminDebtsPage({
  searchParams,
}: {
  searchParams: { status?: string; page?: string; product?: string; creditor?: string; collector?: string; q?: string }
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

  const { t, dir } = getServerTranslation()
  const p = t.pages.debts
  const isAr = dir === 'rtl'

  const page = parseInt(searchParams.page ?? '1')
  const limit = 20
  const offset = (page - 1) * limit

  let query = supabase
    .from('debts')
    .select(`
      *,
      customer:customers(id, full_name, phone, whatsapp),
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

  const statusLabels: Record<string, string> = isAr ? {
    active: 'نشط', in_progress: 'قيد التنفيذ', promised: 'وعود سداد',
    partial: 'سداد جزئي', settled: 'مُسدد', written_off: 'معدوم',
    legal: 'إجراء قانوني', disputed: 'متنازع عليه', payment_plan: 'خطة تقسيط',
  } : {
    active: 'Active', in_progress: 'In progress', promised: 'Promised',
    partial: 'Partial', settled: 'Settled', written_off: 'Written off',
    legal: 'Legal', disputed: 'Disputed', payment_plan: 'Payment plan',
  }

  return (
    <div dir={dir} className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-200">
      <div className="bg-[#151a23] rounded-2xl p-6 border border-[#222a36] flex items-center justify-between mt-6 flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">{p.title}</h1>
          <p className="text-[#8b95a7] text-sm">{p.total_debts_registered} <span className="font-bold text-emerald-400">{count ?? 0}</span></p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ExportDebtsButton status={searchParams.status} />
          <ImportDebtsModal />
          <AddCaseModal />
        </div>
      </div>

      <DebtFilters collectors={collectorsData || []} creditors={creditors} productTypes={productTypes} />

      <div className="bg-[#151a23] rounded-2xl border border-[#222a36] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[#0d1117] border-b border-[#222a36]">
              <tr>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">{p.ref_number}</th>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">{t.ui.customer}</th>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">{p.due_amount}</th>
                <th className="px-6 py-4 text-center font-bold text-[#8b95a7]">{t.ui.status}</th>
                <th className="px-6 py-4 text-center font-bold text-[#8b95a7]">{p.ai_score}</th>
                <th className="px-6 py-4 text-start font-bold text-[#8b95a7]">{p.collector}</th>
                <th className="px-6 py-4 text-center font-bold text-[#8b95a7]">{t.ui.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {(debts ?? []).length === 0 ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-[#5f6b7e]">{p.no_debts}</td></tr>
              ) : (debts ?? []).map((debt: any) => {
                const latestScore = debt.ai_scores?.[0]
                const cust = debt.customer as { id?: string; full_name?: string; phone?: string; whatsapp?: string } | null
                return (
                  <tr key={debt.id} className="hover:bg-[#1a212c] transition-colors">
                    <td className="px-6 py-4"><span className="font-mono text-sm font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded-md border border-blue-500/20">{debt.reference_number}</span></td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-white">{cust?.full_name ?? '—'}</div>
                      <div className="text-[#5f6b7e] text-xs mt-0.5 font-mono" dir="ltr">{cust?.phone ?? ''}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-rose-400">{formatCurrency(debt.current_balance, debt.currency)}</div>
                      <div className="text-[#5f6b7e] text-xs mt-0.5">{p.from_amount.replace('{amount}', formatCurrency(debt.original_amount, debt.currency))}</div>
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
                    <td className="px-6 py-4"><span className="text-sm font-medium text-slate-300 bg-[#222a36] px-2 py-1 rounded-md">{debt.assigned_collector?.full_name ?? t.ui.unassigned}</span></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-center gap-2">
                        {cust?.id && <StartConversationButton customerId={cust.id} phone={cust.whatsapp ?? cust.phone ?? null} />}
                        <Link href={`/dashboard/admin/debts/${debt.id}`} className="inline-block px-3 py-1.5 bg-[#1a212c] border border-[#2c3543] text-slate-200 hover:bg-[#222a36] font-bold rounded-lg text-xs transition-colors whitespace-nowrap">{t.ui.view_details}</Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-[#222a36] flex items-center justify-between bg-[#0d1117]">
            <span className="text-[#8b95a7] text-sm font-medium">{t.ui.page} <span className="font-bold text-white">{page}</span> {t.ui.of} <span className="font-bold text-white">{totalPages}</span></span>
            <div className="flex gap-2">
              {page < totalPages && <Link href={`/dashboard/admin/debts?page=${page + 1}${searchParams.status ? `&status=${searchParams.status}` : ''}`} className="px-4 py-2 bg-[#1a212c] border border-[#2c3543] text-emerald-400 hover:bg-[#222a36] font-bold rounded-xl text-sm transition-colors">{t.ui.next} {isAr ? '←' : '→'}</Link>}
              {page > 1 && <Link href={`/dashboard/admin/debts?page=${page - 1}${searchParams.status ? `&status=${searchParams.status}` : ''}`} className="px-4 py-2 bg-[#1a212c] border border-[#2c3543] text-emerald-400 hover:bg-[#222a36] font-bold rounded-xl text-sm transition-colors">{isAr ? '→' : '←'} {t.ui.previous}</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
