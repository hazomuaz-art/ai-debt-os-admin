import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import CreateCustomerModal from '@/components/debt/CreateCustomerModal'

export default async function ManagerCustomersPage() {
  const supabase = createClient()

  const { data: customers } = await supabase
    .from('customers')
    .select(`*, debts(id, current_balance, status, currency)`)
    .order('created_at', { ascending: false })

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-syne">Customers</h1>
          <p className="text-slate-400">All customers in your portfolio</p>
        </div>
        <CreateCustomerModal />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 border-b border-surface-200">
              <th className="pb-3 pr-4">Name</th>
              <th className="pb-3 pr-4">Phone</th>
              <th className="pb-3 pr-4">City</th>
              <th className="pb-3 pr-4">Debts</th>
              <th className="pb-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {customers?.map((c: any) => (
              <tr key={c.id} className="border-b border-surface-100">
                <td className="py-3 pr-4 font-medium">{c.full_name}</td>
                <td className="py-3 pr-4 text-slate-300">{c.phone || '—'}</td>
                <td className="py-3 pr-4 text-slate-300">{c.city || '—'}</td>
                <td className="py-3 pr-4 text-slate-300">{c.debts?.length ?? 0}</td>
                <td className="py-3 text-slate-400">{formatDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!customers || customers.length === 0) && (
          <p className="text-slate-400 text-center py-8">No customers yet</p>
        )}
      </div>
    </div>
  )
}
