import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { InviteUserModal } from '@/components/dashboard/InviteUserModal'
import UserStatusButton from '@/components/dashboard/UserStatusButton'
import SubscriptionActionButtons from '@/components/dashboard/SubscriptionActionButtons'
import { ArrowRight } from 'lucide-react'

function Card({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#151a23] p-6 rounded-2xl border border-[#222a36] shadow-sm">
      <div className="text-[#8b95a7] text-xs font-bold uppercase tracking-wider">{title}</div>
      <div className="text-white text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[#5f6b7e] text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default async function CompanyDetailsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = createClient()
  const service = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, company_id')
    .eq('id', user.id)
    .single()

  // Lets an admin view/manage ANY other company's users by URL id — same
  // cross-tenant gap as platform/companies/page.tsx, same fix.
  if (!profile?.company_id || profile.role !== 'admin' || profile.company_id !== process.env.PLATFORM_OWNER_COMPANY_ID) {
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
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-start justify-between gap-4 mt-6">
        <div>
          <Link href="/dashboard/admin/platform/companies" className="text-emerald-400 text-sm font-bold hover:text-emerald-300 flex items-center gap-1">
            <ArrowRight size={14} /> رجوع لكل الشركات
          </Link>

          <h1 className="text-2xl font-bold text-white mt-3 mb-1">
            {company.name}
          </h1>

          <p className="text-[#8b95a7] text-sm">
            {company.slug} · تاريخ الإنشاء {company.created_at ? new Date(company.created_at).toLocaleDateString() : '-'}
          </p>
        </div>

        <div className="text-start">
          <div className={company.is_active ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
            {company.is_active ? 'نشطة' : 'معلَّقة'}
          </div>
          <div className="text-[#8b95a7] text-sm mb-2">
            {sub?.plan_name ?? company.plan ?? 'starter'} · {sub?.status ?? 'بلا اشتراك'}
          </div>
          <SubscriptionActionButtons companyId={company.id} status={sub?.status ?? null} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card title="المستخدمون" value={users.length} />
        <Card title="العملاء" value={customers.length} />
        <Card title="الديون" value={debts.length} />
        <Card title="إجمالي الديون" value={totalDebt.toLocaleString()} sub="SAR" />
        <Card title="طلبات AI" value={aiCalls.toLocaleString()} />
        <Card title="واتساب" value={whatsapp.toLocaleString()} />
        <Card title="الرسائل" value={messages.toLocaleString()} />
        <Card title="MRR" value={sub?.mrr_usd ? `$${Number(sub.mrr_usd).toFixed(0)}` : '-'} />
      </div>

      {/* Users */}
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#222a36] flex items-center justify-between gap-3">
          <h2 className="text-white font-bold">المستخدمون</h2>
          <InviteUserModal companyId={company.id} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#0b0e14] text-[#8b95a7] text-xs">
              <tr>
                <th className="text-end p-3 font-bold uppercase">الاسم</th>
                <th className="text-end p-3 font-bold uppercase">البريد</th>
                <th className="text-end p-3 font-bold uppercase">الصلاحية</th>
                <th className="text-end p-3 font-bold uppercase">الحالة</th>
                <th className="text-end p-3 font-bold uppercase">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {users.map((u: any) => (
                <tr key={u.id} className="hover:bg-[#1a212c] transition-colors text-slate-300">
                  <td className="p-3 text-white font-medium">{u.full_name ?? '-'}</td>
                  <td className="p-3 font-mono text-xs">{u.email ?? '-'}</td>
                  <td className="p-3 font-bold">{u.role ?? '-'}</td>
                  <td className="p-3">
                    <span className={u.is_active ? 'text-emerald-400' : 'text-rose-400'}>
                      {u.is_active ? 'نشط' : 'معطَّل'}
                    </span>
                  </td>
                  <td className="p-3">
                    <UserStatusButton userId={u.id} isActive={Boolean(u.is_active)} />
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td className="p-12 text-center bg-[#222a36]/50" colSpan={5}>
                    <div className="text-[#5f6b7e] text-sm font-bold">لا يوجد مستخدمون</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent events */}
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#222a36]">
          <h2 className="text-white font-bold">آخر الأحداث</h2>
        </div>

        <div className="divide-y divide-[#1c2330]">
          {events.map((e: any, index: number) => (
            <div key={index} className="p-4 flex items-center justify-between text-sm">
              <div>
                <div className="text-white font-medium">{e.event_type}</div>
                <div className="text-[#5f6b7e]">{e.note ?? '-'}</div>
              </div>
              <div className="text-[#5f6b7e]">
                {e.created_at ? new Date(e.created_at).toLocaleString() : '-'}
              </div>
            </div>
          ))}

          {events.length === 0 && (
            <div className="p-12 text-center bg-[#222a36]/50">
              <div className="text-[#5f6b7e] text-sm font-bold">لا توجد أحداث مسجَّلة</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
