import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

interface TenantRow {
  id:         string
  name:       string
  plan:       string
  is_active:  boolean
  created_at: string
}

interface UsageRow {
  company_id:   string
  period:       string
  ai_calls_used: number
  whatsapp_sent: number
  total_cost_usd: number
}

interface InfraRow {
  service:    string
  amount_usd: number
  period:     string
}

interface BillingPlan {
  name:         string
  display_name: string
  price_usd:    number
  is_active:    boolean
}

export default async function PlatformPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') redirect('/dashboard/admin')

  const [
    { data: tenants },
    { data: usage },
    { data: infra },
    { data: plans },
  ] = await Promise.all([
    supabase.from('companies').select('id, name, plan, is_active, created_at').order('created_at', { ascending: false }),
    supabase.from('tenant_usage').select('company_id, period, ai_calls_used, whatsapp_sent, total_cost_usd').gte('period', new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 7)),
    supabase.from('infra_costs').select('service, amount_usd, period').order('period', { ascending: false }).limit(12),
    supabase.from('billing_plans').select('name, display_name, price_usd, is_active').order('price_usd'),
  ])

  const allTenants  = (tenants ?? []) as TenantRow[]
  const allUsage    = (usage  ?? []) as UsageRow[]
  const allInfra    = (infra  ?? []) as InfraRow[]
  const allPlans    = (plans  ?? []) as BillingPlan[]

  const totalInfra  = allInfra.reduce((s, r) => s + Number(r.amount_usd ?? 0), 0)
  const totalAI     = allUsage.reduce((s, r) => s + Number(r.total_cost_usd ?? 0), 0)
  const totalCost   = totalInfra + totalAI
  const activeTenants = allTenants.filter(t => t.is_active).length

  const PLAN_COLORS: Record<string, string> = {
    starter:    'bg-white/5 text-white/50',
    growth:     'bg-brand-500/10 text-brand-400',
    enterprise: 'bg-yellow-500/10 text-yellow-400',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Platform Admin</h1>
        <p className="text-white/40 text-sm mt-0.5">إدارة المستأجرين، الباقات، التكاليف، الأرباح</p>
      </div>

      <div className="card p-4 border-blue-500/20 bg-blue-500/5 flex items-center gap-3">
        <span className="text-blue-400 text-lg">ℹ</span>
        <div>
          <div className="text-blue-400 text-sm font-medium">وضع الإعداد</div>
          <p className="text-white/40 text-xs mt-0.5">
            هيكل Multi-Tenant جاهز. نظام Billing يُفعَّل عند إضافة شركات جديدة بباقات مدفوعة.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="text-white/40 text-xs">الشركات</div>
          <div className="font-display text-2xl font-bold">{allTenants.length}</div>
          <div className="text-green-400 text-xs">{activeTenants} نشطة</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs">تكلفة البنية التحتية</div>
          <div className="font-display text-2xl font-bold text-red-400">${totalInfra.toFixed(2)}</div>
          <div className="text-white/30 text-xs">هذا الشهر</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs">تكلفة AI</div>
          <div className="font-display text-2xl font-bold text-yellow-400">${totalAI.toFixed(4)}</div>
          <div className="text-white/30 text-xs">30 يوم</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs">إجمالي التكلفة</div>
          <div className="font-display text-2xl font-bold">${totalCost.toFixed(2)}</div>
          <div className="text-white/30 text-xs">هذا الشهر</div>
        </div>
      </div>

      {/* Billing plans */}
      <div className="card p-5">
        <div className="font-display font-semibold text-sm mb-4">الباقات المتاحة</div>
        <div className="grid grid-cols-3 gap-3">
          {allPlans.map(plan => (
            <div key={plan.name}
              className={`p-4 rounded-xl border border-white/10 ${plan.is_active ? '' : 'opacity-40'}`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${PLAN_COLORS[plan.name] ?? PLAN_COLORS.starter}`}>
                  {plan.display_name}
                </span>
              </div>
              <div className="font-display text-xl font-bold">${plan.price_usd}
                <span className="text-white/30 text-xs font-normal">/شهر</span>
              </div>
              <div className="text-white/30 text-xs mt-1">
                {allTenants.filter(t => t.plan === plan.name).length} شركة
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tenants table */}
      <div className="card p-5">
        <div className="font-display font-semibold text-sm mb-4">الشركات المشتركة</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/30 text-xs border-b border-white/5">
                <th className="pb-2 text-left">الشركة</th>
                <th className="pb-2 text-left">الباقة</th>
                <th className="pb-2 text-left">الحالة</th>
                <th className="pb-2 text-left">تاريخ الإضافة</th>
              </tr>
            </thead>
            <tbody>
              {allTenants.length === 0 && (
                <tr><td colSpan={4} className="py-8 text-center text-white/30">لا توجد شركات</td></tr>
              )}
              {allTenants.map(t => (
                <tr key={t.id} className="border-b border-white/5 last:border-0">
                  <td className="py-2 font-medium">{t.name}</td>
                  <td className="py-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${PLAN_COLORS[t.plan] ?? PLAN_COLORS.starter}`}>
                      {t.plan}
                    </span>
                  </td>
                  <td className="py-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${
                      t.is_active
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : 'bg-white/5 text-white/30 border-white/10'
                    }`}>{t.is_active ? 'نشط' : 'معطّل'}</span>
                  </td>
                  <td className="py-2 text-white/40 text-xs">
                    {new Date(t.created_at).toLocaleDateString('ar-SA')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Infra costs */}
      <div className="card p-5">
        <div className="font-display font-semibold text-sm mb-4">تكاليف البنية التحتية</div>
        {allInfra.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-6">
            لم يتم تسجيل تكاليف بعد — يمكن إضافتها من قاعدة البيانات مباشرة
          </p>
        ) : (
          <div className="space-y-2">
            {allInfra.map((row, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                <span className="text-sm font-mono">{row.service}</span>
                <span className="text-white/50 text-xs">{row.period}</span>
                <span className="font-mono text-sm text-red-400">${Number(row.amount_usd).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
