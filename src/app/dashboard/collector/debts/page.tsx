import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils'
import Link from 'next/link'

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">My Debts</h1>
        <p className="text-slate-500 text-sm">{count ?? 0} assigned debts</p>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="table-header px-4 py-3 text-left">Customer</th>
              <th className="table-header px-4 py-3 text-right">Balance</th>
              <th className="table-header px-4 py-3 text-center">Status</th>
              <th className="table-header px-4 py-3 text-center">Priority</th>
              <th className="table-header px-4 py-3 text-left">Due Date</th>
              <th className="table-header px-4 py-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {(debts ?? []).length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-slate-400">No debts assigned to you yet</td></tr>
            ) : (debts ?? []).map(debt => (
              <tr key={debt.id} className="hover:bg-white/2 transition-colors">
                <td className="px-4 py-3">
                  <div className="text-sm font-medium">{(debt.customer as {full_name?: string} | null)?.full_name ?? '—'}</div>
                  <div className="text-slate-400 text-xs">{(debt.customer as {phone?: string} | null)?.phone ?? ''}</div>
                </td>
                <td className="px-4 py-3 text-right font-semibold">{formatCurrency(debt.current_balance, debt.currency)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`status-badge text-[11px] ${getStatusColor(debt.status)}`}>{debt.status}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`status-badge text-[11px] ${getStatusColor(debt.priority)}`}>{debt.priority}</span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500">{debt.due_date ? formatDate(debt.due_date) : '—'}</td>
                <td className="px-4 py-3 text-center">
                  <Link href={`/dashboard/collector/debts/${debt.id}`} className="text-brand-400 hover:text-brand-300 text-xs font-medium">View</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
