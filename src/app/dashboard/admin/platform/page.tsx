import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  PLAN_DEFINITIONS,
  STATUS_LABELS,
  STATUS_COLORS,
  formatLimit,
  usagePct,
  usageColor,
  type PlanName,
  type SubscriptionStatus,
} from '@/lib/saas-plans'

// ── Inline-safe types (no runtime risk) ──────────────────────────────────

interface UsageData {
  ai_calls_used:    number
  ai_openai_calls:  number
  ai_cache_hits:    number
  ai_template_hits: number
  ai_memory_hits:   number
  whatsapp_sent:    number
  messages_count:   number
}

interface CountData {
  users:     number
  customers: number
  debts:     number
}

interface SubscriptionRow {
  plan_name:            string
  status:               string
  trial_ends_at:        string | null
  current_period_end:   string | null
  billing_cycle:        string | null
  mrr_usd:              number | null
}

// ── Small presentational helpers (no hooks, no state) ────────────────────

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">{label}</div>
      <div className="font-display font-bold text-2xl text-slate-900">{String(value)}</div>
      {sub && <div className="text-slate-400 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

function UsageRow({
  label,
  used,
  limit,
}: {
  label: string
  used:  number
  limit: number | null | undefined
}) {
  const pct    = usagePct(used, limit)
  const color  = usageColor(pct)
  const noLimit = !limit || limit >= 999999

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className="font-mono text-slate-600">
          {used.toLocaleString()}
          <span className="text-slate-400"> / {noLimit ? '∞' : formatLimit(limit)}</span>
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.06)' }}
      >
        <div
          className="h-full rounded-full transition-none"
          style={{
            width:      noLimit ? '8%' : `${pct}%`,
            background: noLimit ? 'rgba(79,70,229,0.4)' : color,
          }}
        />
      </div>
    </div>
  )
}

function PlanCard({
  name,
  current,
}: {
  name:    PlanName
  current: boolean
}) {
  const plan = PLAN_DEFINITIONS[name]
  if (!plan) return null

  return (
    <div
      className={[
        'rounded-2xl border p-5',
        current
          ? 'border-brand-500/40'
          : 'border-slate-200',
      ].join(' ')}
      style={{
        background: current
          ? 'linear-gradient(135deg,rgba(79,70,229,0.08),rgba(15,17,32,0.9))'
          : 'rgba(22,25,42,0.7)',
        boxShadow: current
          ? '0 0 0 1px rgba(99,102,241,0.15), 0 4px 20px rgba(0,0,0,0.4)'
          : '0 4px 16px rgba(0,0,0,0.3)',
      }}
    >
      {/* Badge row */}
      <div className="flex items-center justify-between mb-4">
        <span className={`status-badge text-[10px] ${plan.badge_color}`}>
          {plan.display_name}
        </span>
        {current && (
          <span
            className="text-[9px] font-bold px-2 py-0.5 rounded-full text-slate-900"
            style={{ background: 'linear-gradient(135deg,#4f46e5,#7c3aed)' }}
          >
            CURRENT
          </span>
        )}
      </div>

      {/* Price */}
      <div className="font-display font-bold text-2xl text-slate-900 mb-1">
        ${plan.monthly_usd}
        <span className="text-xs font-normal text-slate-400 ms-1">/mo</span>
      </div>
      <div className="text-[10px] text-white/25 mb-4">
        ${plan.annual_usd}/mo billed annually
      </div>

      {/* Key limits */}
      <div className="space-y-1.5 mb-4">
        {([
          ['Users',          plan.limits.max_users],
          ['Customers',      plan.limits.max_customers],
          ['AI Actions/day', plan.limits.daily_ai_actions],
          ['WhatsApp/mo',    plan.limits.monthly_whatsapp],
        ] as [string, number][]).map(([lbl, val]) => (
          <div key={lbl} className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">{lbl}</span>
            <span className="font-mono text-slate-600">{formatLimit(val)}</span>
          </div>
        ))}
      </div>

      {/* Features */}
      <div className="flex flex-wrap gap-1.5 text-[10px]">
        {([
          ['WhatsApp',  plan.features.whatsapp],
          ['Campaigns', plan.features.campaigns],
          ['Voice AI',  plan.features.voice],
          ['API',       plan.features.api_access],
        ] as [string, boolean][]).map(([lbl, on]) => (
          <span
            key={lbl}
            className={[
              'px-2 py-0.5 rounded-lg border',
              on
                ? 'bg-green-500/8 text-green-400 border-green-500/15'
                : 'bg-white/3 text-slate-400 border-slate-200 line-through',
            ].join(' ')}
          >
            {on ? '✓ ' : '— '}{lbl}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Page (pure Server Component) ─────────────────────────────────────────

export default async function PlatformPage() {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role, full_name')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || profile.role !== 'admin') {
    redirect('/dashboard/admin')
  }

  const cid    = profile.company_id
  const period = new Date().toISOString().slice(0, 7) // YYYY-MM
  const today  = new Date().toISOString().split('T')[0]

  // ── Safe parallel fetches — every query has a fallback ─────────────────

  const [
    companyRes,
    subRes,
    usageRes,
    userCountRes,
    customerCountRes,
    debtCountRes,
    aiTodayRes,
    waTodayRes,
  ] = await Promise.allSettled([
    supabase.from('companies').select('name, plan, is_active').eq('id', cid).single(),
    supabase.from('company_subscriptions').select('plan_name,status,trial_ends_at,current_period_end,billing_cycle,mrr_usd').eq('company_id', cid).maybeSingle(),
    supabase.from('tenant_usage').select('ai_calls_used,ai_openai_calls,ai_cache_hits,ai_template_hits,ai_memory_hits,whatsapp_sent,messages_count').eq('company_id', cid).eq('period', period).maybeSingle(),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('company_id', cid),
    supabase.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', cid),
    supabase.from('debts').select('id', { count: 'exact', head: true }).eq('company_id', cid),
    supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('company_id', cid).in('event_type', ['ai_action', 'openai_call']).gte('created_at', `${today}T00:00:00Z`),
    supabase.from('usage_events').select('id', { count: 'exact', head: true }).eq('company_id', cid).eq('event_type', 'whatsapp_sent').gte('created_at', `${period}-01T00:00:00Z`),
  ])

  // ── Extract values with safe fallbacks ───────────────────────────────

  const company  = companyRes.status === 'fulfilled' ? companyRes.value.data  : null
  const subRaw   = subRes.status     === 'fulfilled' ? subRes.value.data      : null
  const usageRaw = usageRes.status   === 'fulfilled' ? usageRes.value.data    : null

  const sub: SubscriptionRow | null = subRaw
    ? {
        plan_name:          String((subRaw as Record<string,unknown>).plan_name  ?? 'starter'),
        status:             String((subRaw as Record<string,unknown>).status      ?? 'trial'),
        trial_ends_at:      (subRaw as Record<string,unknown>).trial_ends_at as string | null,
        current_period_end: (subRaw as Record<string,unknown>).current_period_end as string | null,
        billing_cycle:      (subRaw as Record<string,unknown>).billing_cycle as string | null,
        mrr_usd:            Number((subRaw as Record<string,unknown>).mrr_usd ?? 0),
      }
    : null

  const usage: UsageData = {
    ai_calls_used:    Number((usageRaw as Record<string,unknown> | null)?.ai_calls_used    ?? 0),
    ai_openai_calls:  Number((usageRaw as Record<string,unknown> | null)?.ai_openai_calls  ?? 0),
    ai_cache_hits:    Number((usageRaw as Record<string,unknown> | null)?.ai_cache_hits    ?? 0) +
                      Number((usageRaw as Record<string,unknown> | null)?.ai_template_hits ?? 0) +
                      Number((usageRaw as Record<string,unknown> | null)?.ai_memory_hits   ?? 0),
    ai_template_hits: Number((usageRaw as Record<string,unknown> | null)?.ai_template_hits ?? 0),
    ai_memory_hits:   Number((usageRaw as Record<string,unknown> | null)?.ai_memory_hits   ?? 0),
    whatsapp_sent:    Number((usageRaw as Record<string,unknown> | null)?.whatsapp_sent     ?? 0),
    messages_count:   Number((usageRaw as Record<string,unknown> | null)?.messages_count   ?? 0),
  }

  const counts: CountData = {
    users:     (userCountRes.status     === 'fulfilled' ? userCountRes.value.count     : 0) ?? 0,
    customers: (customerCountRes.status === 'fulfilled' ? customerCountRes.value.count : 0) ?? 0,
    debts:     (debtCountRes.status     === 'fulfilled' ? debtCountRes.value.count     : 0) ?? 0,
  }

  const aiToday  = (aiTodayRes.status === 'fulfilled' ? aiTodayRes.value.count  : 0) ?? 0
  const waMonth  = (waTodayRes.status === 'fulfilled' ? waTodayRes.value.count  : 0) ?? 0

  // Plan resolution
  const rawPlan      = sub?.plan_name ?? company?.plan ?? 'starter'
  const planName     = (rawPlan in PLAN_DEFINITIONS ? rawPlan : 'starter') as PlanName
  const plan         = PLAN_DEFINITIONS[planName]

  // Status
  const statusKey  = (sub?.status ?? 'trial') as SubscriptionStatus
  const statusLabel = STATUS_LABELS[statusKey] ?? statusKey
  const statusColor = STATUS_COLORS[statusKey]  ?? STATUS_COLORS.trial

  // Cache hit rate
  const totalAI   = usage.ai_openai_calls + usage.ai_cache_hits
  const cacheRate = totalAI > 0 ? Math.round((usage.ai_cache_hits / totalAI) * 100) : 0

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div>
        <h1 className="font-display font-bold text-2xl text-slate-900">Plans &amp; Usage</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Subscription status and usage overview for{' '}
          <span className="text-slate-500">{company?.name ?? 'your company'}</span>
        </p>
      </div>

      {/* Subscription banner */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`status-badge text-[10px] ${plan.badge_color}`}>
                {plan.display_name}
              </span>
              <span className={`status-badge text-[10px] ${statusColor}`}>
                {statusLabel}
              </span>
              {company?.is_active === false && (
                <span className="status-badge text-[10px] bg-red-500/10 text-red-400 border-red-500/20">
                  Suspended
                </span>
              )}
            </div>
            <div className="text-slate-400 text-xs mt-1 space-y-0.5">
              {sub?.billing_cycle && (
                <div>Billing: {sub.billing_cycle}</div>
              )}
              {sub?.trial_ends_at && statusKey === 'trial' && (
                <div>
                  Trial ends:{' '}
                  {new Date(sub.trial_ends_at).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </div>
              )}
              {sub?.current_period_end && statusKey === 'active' && (
                <div>
                  Renews:{' '}
                  {new Date(sub.current_period_end).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'short', day: 'numeric',
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="text-start shrink-0">
            <div className="font-display font-bold text-2xl text-slate-900">
              ${plan.monthly_usd}
              <span className="text-sm font-normal text-slate-400">/mo</span>
            </div>
            {sub?.mrr_usd && Number(sub.mrr_usd) > 0 && (
              <div className="text-xs text-slate-400 mt-0.5">
                MRR: ${Number(sub.mrr_usd).toFixed(2)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        <Stat label="Users"       value={counts.users}     />
        <Stat label="Customers"   value={counts.customers} />
        <Stat label="Debts"       value={counts.debts}     />
        <Stat label="AI Today"    value={aiToday}          sub="actions" />
        <Stat label="WA This Mo." value={waMonth}          sub="messages" />
        <Stat label="Cache Rate"  value={`${cacheRate}%`}  sub="AI requests saved" />
      </div>

      {/* Usage vs limits */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* AI usage */}
        <div className="card p-5">
          <h2 className="section-title mb-5">AI &amp; API Usage</h2>
          <div className="space-y-4">
            <UsageRow
              label="AI Actions (today)"
              used={aiToday}
              limit={plan.limits.daily_ai_actions}
            />
            <UsageRow
              label="OpenAI Calls (month)"
              used={usage.ai_openai_calls}
              limit={plan.limits.daily_openai_calls * 30}
            />
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Cache / Template hits</span>
                <span className="font-mono">
                  <span className="text-slate-600">{usage.ai_cache_hits.toLocaleString()}</span>
                  <span className="text-green-400 ms-2 text-[10px] font-semibold">
                    {cacheRate}% saved
                  </span>
                </span>
              </div>
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <div
                  className="h-full rounded-full transition-none"
                  style={{ width: `${cacheRate}%`, background: '#10b981' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Data & messaging usage */}
        <div className="card p-5">
          <h2 className="section-title mb-5">Data &amp; Messaging</h2>
          <div className="space-y-4">
            <UsageRow
              label="Users"
              used={counts.users}
              limit={plan.limits.max_users}
            />
            <UsageRow
              label="Customers"
              used={counts.customers}
              limit={plan.limits.max_customers}
            />
            <UsageRow
              label="Debts"
              used={counts.debts}
              limit={plan.limits.max_debts}
            />
            <UsageRow
              label="WhatsApp messages (month)"
              used={waMonth}
              limit={plan.limits.monthly_whatsapp}
            />
          </div>
        </div>
      </div>

      {/* Plan comparison */}
      <div>
        <h2 className="section-title mb-4">Available Plans</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <PlanCard name="starter"    current={planName === 'starter'}    />
          <PlanCard name="business"   current={planName === 'business' || planName === 'growth'} />
          <PlanCard name="enterprise" current={planName === 'enterprise'} />
        </div>
        <p className="text-[11px] text-white/25 text-center mt-4">
          To upgrade or request custom limits, contact{' '}
          <span className="text-brand-400">support@ai-debt-os.com</span>
        </p>
      </div>
    </div>
  )
}
