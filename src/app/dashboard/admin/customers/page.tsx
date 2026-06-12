import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate, getStatusColor } from '@/lib/utils'
import { CreateCustomerModal } from '@/components/debt/CreateCustomerModal'

export default async function AdminCustomersPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) redirect('/login')

  const { data: customers, count } = await supabase
    .from('customers')
    .select('*', { count: 'exact' })
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Customers</h1>
          <p className="text-slate-500 text-sm">{count ?? 0} total customers</p>
        </div>
        <CreateCustomerModal />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="table-header px-4 py-3 text-left">Name</th>
              <th className="table-header px-4 py-3 text-left">Contact</th>
              <th className="table-header px-4 py-3 text-left">National ID</th>
              <th className="table-header px-4 py-3 text-center">Risk Level</th>
              <th className="table-header px-4 py-3 text-left">City</th>
              <th className="table-header px-4 py-3 text-left">Added</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {(customers ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-400">No customers yet.</td>
              </tr>
            ) : (customers ?? []).map(c => (
              <tr key={c.id} className="hover:bg-white/2 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-brand-800/50 rounded-full flex items-center justify-center text-xs font-semibold text-brand-400">
                      {c.full_name?.charAt(0) ?? '?'}
                    </div>
                    <span className="text-sm font-medium">{c.full_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-slate-500">{c.phone ?? c.email ?? '—'}</div>
                  {c.whatsapp && <div className="text-xs text-green-400/60">WA: {c.whatsapp}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-slate-500">{c.national_id ?? '—'}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`status-badge text-[11px] ${getStatusColor(c.risk_level)}`}>
                    {c.risk_level}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-slate-500">{c.city ?? '—'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-slate-500">{formatDate(c.created_at)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
