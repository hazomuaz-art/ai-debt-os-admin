import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import Link from 'next/link'

export default async function ManagerDebtsPage({ searchParams }: { searchParams: { status?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let query = supabase
    .from('debts')
    .select(`
      *,
      customer:customers(full_name, phone),
      assigned_to_profile:profiles!debts_assigned_to_fkey(full_name)
    `)
    .order('created_at', { ascending: false })

  if (searchParams.status) query = (query as any).eq('status', searchParams.status)

  const { data: debts } = await query

  const statuses = ['active', 'in_negotiation', 'payment_plan', 'settled', 'legal', 'written_off']

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-syne">All Debts</h1>
          <p className="text-slate-400">{debts?.length ?? 0} total</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Link href="/dashboard/manager/debts"
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${!searchParams.status ? 'bg-brand-600/20 text-brand-400 border-brand-600/30' : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-900'}`}>
          All
        </Link>
        {statuses.map(s => (
          <Link key={s} href={`/dashboard/manager/debts?status=${s}`}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${searchParams.status === s ? 'bg-brand-600/20 text-brand-400 border-brand-600/30' : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-900'}`}>
            {s.replace(/_/g, ' ')}
          </Link>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-200">
              <th className="pb-3 pr-4">Reference</th>
              <th className="pb-3 pr-4">Customer</th>
              <th className="pb-3 pr-4">Balance</th>
              <th className="pb-3 pr-4">Status</th>
              <th className="pb-3 pr-4">Priority</th>
              <th className="pb-3 pr-4">Collector</th>
              <th className="pb-3">Due Date</th>
            </tr>
          </thead>
          <tbody>
            {debts?.map((debt: any) => (
              <tr key={debt.id} className="border-b border-slate-200 hover:bg-slate-50">
                <td className="py-3 pr-4">
                  <Link href={`/dashboard/admin/debts/${debt.id}`} className="font-mono text-xs text-brand-400 hover:underline">
                    {debt.reference_number}
                  </Link>
                </td>
                <td className="py-3 pr-4">
                  <p className="font-medium">{debt.customer?.full_name}</p>
                  <p className="text-xs text-slate-400">{debt.customer?.phone}</p>
                </td>
                <td className="py-3 pr-4 font-medium">{formatCurrency(debt.current_balance, debt.currency)}</td>
                <td className="py-3 pr-4">
                  <span className="px-2 py-0.5 rounded text-xs bg-slate-50 text-slate-300">
                    {debt.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    debt.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                    debt.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                    debt.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-slate-500/20 text-slate-400'
                  }`}>
                    {debt.priority}
                  </span>
                </td>
                <td className="py-3 pr-4 text-slate-300">{debt.assigned_to_profile?.full_name || 'Unassigned'}</td>
                <td className="py-3 text-slate-400">{formatDate(debt.due_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!debts || debts.length === 0) && (
          <p className="text-slate-400 text-center py-8">No debts found</p>
        )}
      </div>
    </div>
  )
}
