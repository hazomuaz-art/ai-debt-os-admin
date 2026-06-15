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
          <p className="text-[#5f6b7e]">All customers in your portfolio</p>
        </div>
        <CreateCustomerModal />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-end text-[#5f6b7e] border-b border-[#222a36]">
              <th className="pb-3 pe-4">Name</th>
              <th className="pb-3 pe-4">Phone</th>
              <th className="pb-3 pe-4">City</th>
              <th className="pb-3 pe-4">Debts</th>
              <th className="pb-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {customers?.map((c: any) => (
              <tr key={c.id} className="border-b border-[#222a36]">
                <td className="py-3 pe-4 font-medium">{c.full_name}</td>
                <td className="py-3 pe-4 text-slate-300">{c.phone || '—'}</td>
                <td className="py-3 pe-4 text-slate-300">{c.city || '—'}</td>
                <td className="py-3 pe-4 text-slate-300">{c.debts?.length ?? 0}</td>
                <td className="py-3 text-[#5f6b7e]">{formatDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(!customers || customers.length === 0) && (
          <p className="text-[#5f6b7e] text-center py-8">No customers yet</p>
        )}
      </div>
    </div>
  )
}
