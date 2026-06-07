import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { InviteUserModal } from '@/components/dashboard/InviteUserModal'

function Card({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-white/40 text-xs uppercase tracking-wider">{title}</div>
      <div className="text-white text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-white/30 text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default async function CompanyDetailsPage({ params }: { params: { id: string } }) {
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

  const companyId = params.id

  const [
    companyRes,
    usersRes,
    customersRes,
    debtsRes,
    usageRes,
    subRes,
    eventsRes,
  ] = await Promise.allSettled([
    service.from('companies').select('id,name,slug,plan,is_active,created_at').eq('id', companyId).single(),
    service.from('profiles').select('id,email,full_name,role,is_active,created_at').eq('company_id', companyId).order('created_at', { ascending: false }),
    service.from('customers').select('id').eq('company_id', companyId),
    service.from('debts').select('id,current_balance,status').eq('company_id', companyId),
    service.from('tenant_usage').select('ai_openai_calls,whatsapp_sent,messages_count').eq('company_id', companyId),
    service.from('company_subscriptions').select('plan_name,status,billing_cycle,mrr_usd,current_period_end').eq('company_id', companyId).maybeSingle(),
    service.from('tenant_events').select('event_type,note,created_at').eq('company_id', companyId).order('created_at', { ascending: false }).limit(10),
  ])

  const company = companyRes.status === 'fulfilled' ? companyRes.value.data : null
  if (!company) notFound()

  const users = usersRes.status === 'fulfilled' ? (usersRes.value.data ?? []) : []
  const customers = customersRes.status === 'fulfilled' ? (customersRes.value.data ?? []) : []
  const debts = debtsRes.status === 'fulfilled' ? (debtsRes.value.data ?? []) : []
  const usage = usageRes.status === 'fulfilled' ? (usageRes.value.data ?? []) : []
  const sub = subRes.status === 'fulfilled' ? subRes.value.data : null
  const events = eventsRes.status === 'fulfilled' ? (eventsRes.value.data ?? []) : []

  const totalDebt = debts.reduce((sum: number, d: any) => sum + Number(d.current_balance ?? 0), 0)
  const aiCalls = usage.reduce((sum: number, r: any) => sum + Number(r.ai_openai_calls ?? 0), 0)
  const whatsapp = usage.reduce((sum: number, r: any) => sum + Number(r.whatsapp_sent ?? 0), 0)
  const messages = usage.reduce((sum: number, r: any) => sum + Number(r.messages_count ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/admin/platform/companies" className="text-brand-400 text-sm hover:text-brand-300">
            ? Back to Companies
          </Link>

          <h1 className="font-display font-bold text-2xl text-white mt-3">
            {company.name}
          </h1>

          <p className="text-white/40 text-sm mt-1">
            {company.slug} · Created {company.created_at ? new Date(company.created_at).toLocaleDateString() : '-'}
          </p>
        </div>

        <div className="text-right">
          <div className={company.is_active ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
            {company.is_active ? 'Active' : 'Suspended'}
          </div>
          <div className="text-white/40 text-sm">
            {sub?.plan_name ?? company.plan ?? 'starter'} · {sub?.status ?? 'no subscription'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="Users" value={users.length} />
        <Card title="Customers" value={customers.length} />
        <Card title="Debts" value={debts.length} />
        <Card title="Total Debt" value={totalDebt.toLocaleString()} sub="SAR" />
        <Card title="AI Calls" value={aiCalls.toLocaleString()} />
        <Card title="WhatsApp" value={whatsapp.toLocaleString()} />
        <Card title="Messages" value={messages.toLocaleString()} />
        <Card title="MRR" value={sub?.mrr_usd ? `$${Number(sub.mrr_usd).toFixed(0)}` : '-'} />
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center justify-between gap-3"><h2 className="text-white font-semibold">Users</h2><InviteUserModal companyId={company.id} /></div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-white/40 border-b border-white/10">
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Role</th>
              <th className="text-left p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u: any) => (
              <tr key={u.id} className="border-b border-white/5 text-white/70">
                <td className="p-3">{u.full_name ?? '-'}</td>
                <td className="p-3">{u.email ?? '-'}</td>
                <td className="p-3">{u.role ?? '-'}</td>
                <td className="p-3">
                  <span className={u.is_active ? 'text-green-400' : 'text-red-400'}>
                    {u.is_active ? 'active' : 'disabled'}
                  </span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="p-6 text-white/40 text-center" colSpan={4}>No users found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-white/10">
          <h2 className="text-white font-semibold">Recent Tenant Events</h2>
        </div>

        <div className="divide-y divide-white/5">
          {events.map((e: any, index: number) => (
            <div key={index} className="p-4 flex items-center justify-between text-sm">
              <div>
                <div className="text-white">{e.event_type}</div>
                <div className="text-white/30">{e.note ?? '-'}</div>
              </div>
              <div className="text-white/30">
                {e.created_at ? new Date(e.created_at).toLocaleString() : '-'}
              </div>
            </div>
          ))}

          {events.length === 0 && (
            <div className="p-6 text-white/40 text-center">No events found.</div>
          )}
        </div>
      </div>
    </div>
  )
}

