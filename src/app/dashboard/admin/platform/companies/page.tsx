import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CreateCompanyModal } from '@/components/dashboard/CreateCompanyModal'
import { Building2 } from 'lucide-react'

function Card({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#151a23] p-6 rounded-2xl border border-[#222a36] shadow-sm">
      <div className="text-[#8b95a7] text-xs font-bold uppercase tracking-wider">{title}</div>
      <div className="text-white text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[#5f6b7e] text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default async function PlatformCompaniesPage() {
  const supabase = await createClient()
  const service = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  // This page lists EVERY company on the platform (cross-tenant) — checking
  // only role==='admin' let ANY company's admin view every other company's
  // name/plan/usage/financials by navigating here directly. Restricted to
  // the platform owner's own company, same env-var pattern as
  // DEFAULT_COMPANY_ID used elsewhere in this codebase.
  if (!profile?.company_id || profile.role !== 'admin' || profile.company_id !== process.env.PLATFORM_OWNER_COMPANY_ID) {
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
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <Building2 size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">إدارة الشركات</h1>
            <p className="text-[#8b95a7] text-sm">نظرة شاملة على كل الشركات والاشتراكات والاستخدام</p>
          </div>
        </div>
        <CreateCompanyModal />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="الشركات" value={companies.length} sub={`${activeCompanies} نشطة`} />
        <Card title="المستخدمون" value={users.length} />
        <Card title="العملاء" value={customers.length} />
        <Card title="إجمالي الديون" value={totalBalance.toLocaleString()} sub="SAR" />
      </div>

      {/* Table */}
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#222a36]">
          <h2 className="text-white font-bold">الشركات</h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#0b0e14] text-[#8b95a7] text-xs">
              <tr>
                <th className="text-end p-3 font-bold uppercase">الشركة</th>
                <th className="text-end p-3 font-bold uppercase">الخطة</th>
                <th className="text-end p-3 font-bold uppercase">الحالة</th>
                <th className="text-start p-3 font-bold uppercase">المستخدمون</th>
                <th className="text-start p-3 font-bold uppercase">العملاء</th>
                <th className="text-start p-3 font-bold uppercase">الديون</th>
                <th className="text-start p-3 font-bold uppercase">طلبات AI</th>
                <th className="text-start p-3 font-bold uppercase">واتساب</th>
                <th className="text-start p-3 font-bold uppercase">MRR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {companies.map((c: any) => {
                const sub = subscription(c.id)
                return (
                  <tr key={c.id} className="hover:bg-[#1a212c] transition-colors text-slate-300">
                    <td className="p-3">
                      <Link href={`/dashboard/admin/platform/companies/${c.id}`} className="text-white font-bold hover:text-emerald-400">{c.name}</Link>
                      <div className="text-[#5f6b7e] text-xs">{c.slug}</div>
                    </td>
                    <td className="p-3">{sub?.plan_name ?? c.plan ?? 'starter'}</td>
                    <td className="p-3">
                      <span className={c.is_active ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {c.is_active ? 'نشطة' : 'معلَّقة'}
                      </span>
                    </td>
                    <td className="p-3 text-start">{countByCompany(users, c.id)}</td>
                    <td className="p-3 text-start">{countByCompany(customers, c.id)}</td>
                    <td className="p-3 text-start">{countByCompany(debts, c.id)}</td>
                    <td className="p-3 text-start">{sumUsage(c.id, 'ai_openai_calls').toLocaleString()}</td>
                    <td className="p-3 text-start">{sumUsage(c.id, 'whatsapp_sent').toLocaleString()}</td>
                    <td className="p-3 text-start">
                      {sub?.mrr_usd ? `$${Number(sub.mrr_usd).toFixed(0)}` : '-'}
                    </td>
                  </tr>
                )
              })}
              {companies.length === 0 && (
                <tr>
                  <td className="p-12 text-center bg-[#222a36]/50" colSpan={9}>
                    <div className="text-[#5f6b7e] text-sm font-bold">لا توجد شركات حالياً</div>
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
