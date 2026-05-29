import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import { CreateDebtModal } from '@/components/debt/CreateDebtModal'
import ImportDebtsModal from '@/components/debt/ImportDebtsModal'
import ExportDebtsButton from '@/components/debt/ExportDebtsButton'
import Link from 'next/link'

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

  if (searchParams.status) {
    query = query.eq('status', searchParams.status)
  }

  const { data: debts, count } = await query
  const totalPages = Math.ceil((count ?? 0) / limit)

  const statuses = ['active', 'in_progress', 'promised', 'partial', 'settled', 'legal', 'disputed', 'written_off']

  const statusLabels: Record<string, string> = {
    active: 'Active', in_progress: 'In Progress', promised: 'Promised',
    partial: 'Partial', settled: 'Settled', written_off: 'Written Off',
    legal: 'Legal', disputed: 'Disputed',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Debts</h1>
          <p className="text-white/40 text-sm">{count ?? 0} total debts</p>
        </div>
        <div className="flex gap-3">
          <ExportDebtsButton status={searchParams.status} />
          <ImportDebtsModal />
          <CreateDebtModal />
        </div>
      </div>

      {/* Status filter */}
      <div className="flex gap-2 flex-wrap">
        <Link href="/dashboard/admin/debts" className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${!searchParams.status ? 'bg-brand-600/20 text-brand-400 border-brand-600/30' : 'bg-white/5 text-white/40 border-white/10 hover:text-white'}`}>
          All
        </Link>
        {statuses.map(status => (
          <Link key={status} href={`/dashboard/admin/debts?status=${status}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${searchParams.status === status ? 'bg-brand-600/20 text-brand-400 border-brand-600/30' : 'bg-white/5 text-white/40 border-white/10 hover:text-white'}`}>
            {statusLabels[status]}
          </Link>
        ))}
      </div>

      {/* Debts table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="table-header px-4 py-3 text-left">Reference</th>
                <th className="table-header px-4 py-3 text-left">Customer</th>
                <th className="table-header px-4 py-3 text-right">Balance</th>
                <th className="table-header px-4 py-3 text-center">Status</th>
                <th className="table-header px-4 py-3 text-center">AI Score</th>
                <th className="table-header px-4 py-3 text-left">Collector</th>
                <th className="table-header px-4 py-3 text-left">Due Date</th>
                <th className="table-header px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(debts ?? []).length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-white/30">
                    No debts found. Create your first debt to get started.
                  </td>
                </tr>
              ) : (debts ?? []).map((debt: {
                id: string
                reference_number: string
                current_balance: number
                original_amount: number
                currency: string
                status: string
                priority: string
                due_date?: string
                customer?: { id?: string; full_name?: string; phone?: string } | null
                assigned_collector?: { id?: string; full_name?: string } | null
                ai_scores?: Array<{ score?: number; risk_classification?: string }> | null
              }) => {
                const latestScore = debt.ai_scores?.[0]
                return (
                  <tr key={debt.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-brand-400">{debt.reference_number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium">{(debt.customer as {full_name?: string} | null)?.full_name ?? '—'}</div>
                      <div className="text-white/30 text-xs">{(debt.customer as {phone?: string} | null)?.phone ?? ''}</div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="text-sm font-semibold">{formatCurrency(debt.current_balance, debt.currency)}</div>
                      <div className="text-white/30 text-xs">of {formatCurrency(debt.original_amount, debt.currency)}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`status-badge text-[11px] ${getStatusColor(debt.status)}`}>
                        {statusLabels[debt.status] ?? debt.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {latestScore ? (
                        <div className="flex items-center justify-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${latestScore.score! >= 70 ? 'bg-green-400' : latestScore.score! >= 40 ? 'bg-yellow-400' : 'bg-red-400'}`} />
                          <span className="font-mono text-sm">{latestScore.score}</span>
                        </div>
                      ) : (
                        <span className="text-white/20 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-white/60">{(debt.assigned_collector as {full_name?: string} | null)?.full_name ?? 'Unassigned'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm text-white/60">{debt.due_date ? formatDate(debt.due_date) : '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link href={`/dashboard/admin/debts/${debt.id}`} className="text-brand-400 hover:text-brand-300 text-xs font-medium">
                        View
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
          <div className="px-4 py-3 border-t border-white/5 flex items-center justify-between">
            <span className="text-white/40 text-sm">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link href={`/dashboard/admin/debts?page=${page - 1}${searchParams.status ? `&status=${searchParams.status}` : ''}`} className="btn-secondary text-xs py-1.5 px-3">
                  Previous
                </Link>
              )}
              {page < totalPages && (
                <Link href={`/dashboard/admin/debts?page=${page + 1}${searchParams.status ? `&status=${searchParams.status}` : ''}`} className="btn-secondary text-xs py-1.5 px-3">
                  Next
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
