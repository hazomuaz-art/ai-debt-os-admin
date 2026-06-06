import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'

function Card({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-white/40 text-xs uppercase tracking-wider">{title}</div>
      <div className="text-white text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-white/30 text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default async function PlatformCompaniesPage() {
  const supabase = createClient()
  const service = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || profile.role !== 'admin') {
    redirect('/dashboard/admin')
  }

  const [
    companiesRes,
    usersRes,
    customersRes,
    debtsRes,
    usageRes,
    subsRes,
  ] = await Promise.allSettled([
    service.from('companies').select('id,name,slug,plan,is_active,created_at').order('created_at', { ascending: false }),
    service.from('profiles').select('id,company_id,is_active'),
    service.from('customers').select('id,company_id'),
    service.from('debts').select('id,company_id,current_balance,status'),
    service.from('tenant_usage').select('company_id,period,ai_calls_used,ai_openai_calls,whatsapp_sent,messages_count'),
    service.from('company_subscriptions').select('company_id,plan_name,status,billing_cycle,mrr_usd,current_period_end'),
  ])

  const companies = companiesRes.status === 'fulfilled' ? (companiesRes.value.data ?? []) : []
  const users = usersRes.status === 'fulfilled' ? (usersRes.value.data ?? []) : []
  const customers = customersRes.status === 'fulfilled' ? (customersRes.value.data ?? []) : []
  const debts = debtsRes.status === 'fulfilled' ? (debtsRes.value.data ?? []) : []
  const usage = usageRes.status === 'fulfilled' ? (usageRes.value.data ?? []) : []
  const subs = subsRes.status === 'fulfilled' ? (subsRes.value.data ?? []) : []

  const totalBalance = debts.reduce((sum: number, d: any) => sum + Number(d.current_balance ?? 0), 0)
  const activeCompanies = companies.filter((c: any) => c.is_active).length

  function countByCompany(rows: any[], cid: string) {
    return rows.filter((r) => r.company_id === cid).length
  }

  function sumUsage(cid: string, field: string) {
    return usage
      .filter((r: any) => r.company_id === cid)
      .reduce((sum: number, r: any) => sum + Number(r[field] ?? 0), 0)
  }

  function subscription(cid: string) {
    return subs.find((s: any) => s.company_id === cid)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl text-white">Platform Companies</h1>
        <p className="text-white/40 text-sm mt-1">
          Super-admin overview for companies, subscriptions, usage, and tenant activity.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="Companies" value={companies.length} sub={`${activeCompanies} active`} />
        <Card title="Users" value={users.length} />
        <Card title="Customers" value={customers.length} />
        <Card title="Total Debt" value={totalBalance.toLocaleString()} sub="SAR" />
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h2 className="text-white font-semibold">Companies</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 border-b border-white/10">
                <th className="text-left p-3">Company</th>
                <th className="text-left p-3">Plan</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Users</th>
                <th className="text-right p-3">Customers</th>
                <th className="text-right p-3">Debts</th>
                <th className="text-right p-3">AI Calls</th>
                <th className="text-right p-3">WhatsApp</th>
                <th className="text-right p-3">MRR</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c: any) => {
                const sub = subscription(c.id)
                return (
                  <tr key={c.id} className="border-b border-white/5 text-white/70">
                    <td className="p-3">
                      <Link href={`/dashboard/admin/platform/companies/${c.id}`} className="text-white font-medium hover:text-brand-400">{c.name}</Link>
                      <div className="text-white/30 text-xs">{c.slug}</div>
                    </td>
                    <td className="p-3">{sub?.plan_name ?? c.plan ?? 'starter'}</td>
                    <td className="p-3">
                      <span className={c.is_active ? 'text-green-400' : 'text-red-400'}>
                        {c.is_active ? 'active' : 'suspended'}
                      </span>
                    </td>
                    <td className="p-3 text-right">{countByCompany(users, c.id)}</td>
                    <td className="p-3 text-right">{countByCompany(customers, c.id)}</td>
                    <td className="p-3 text-right">{countByCompany(debts, c.id)}</td>
                    <td className="p-3 text-right">{sumUsage(c.id, 'ai_openai_calls').toLocaleString()}</td>
                    <td className="p-3 text-right">{sumUsage(c.id, 'whatsapp_sent').toLocaleString()}</td>
                    <td className="p-3 text-right">
                      {sub?.mrr_usd ? `$${Number(sub.mrr_usd).toFixed(0)}` : '-'}
                    </td>
                  </tr>
                )
              })}
              {companies.length === 0 && (
                <tr>
                  <td className="p-6 text-white/40 text-center" colSpan={9}>
                    No companies found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
