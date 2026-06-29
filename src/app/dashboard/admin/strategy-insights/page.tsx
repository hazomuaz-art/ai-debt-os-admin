import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TrendingUp } from 'lucide-react'

const LOOKBACK_WINDOW_MS = 60 * 60 * 1000

function Card({ title, value, sub }: { title: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#151a23] p-6 rounded-2xl border border-[#222a36] shadow-sm">
      <div className="text-[#8b95a7] text-xs font-bold uppercase tracking-wider">{title}</div>
      <div className="text-white text-2xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[#5f6b7e] text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default async function StrategyInsightsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard/admin')
  }

  const service = createServiceClient()
  const companyId = profile.company_id

  const [promisesRes, messagesRes, disputesRes, attributionRes] = await Promise.allSettled([
    service.from('promises').select('customer_id, status, created_at')
      .eq('company_id', companyId).in('status', ['kept', 'broken']).limit(2000),
    service.from('messages').select('customer_id, sent_at, metadata')
      .eq('company_id', companyId).eq('direction', 'outbound').limit(5000),
    service.from('disputes').select('dispute_type').eq('company_id', companyId).limit(2000),
    service.from('collection_attribution').select('days_to_collect').eq('company_id', companyId).limit(2000),
  ])

  const promises = promisesRes.status === 'fulfilled' ? (promisesRes.value.data ?? []) : []
  const allMessages = messagesRes.status === 'fulfilled' ? (messagesRes.value.data ?? []) : []
  const disputes = disputesRes.status === 'fulfilled' ? (disputesRes.value.data ?? []) : []
  const attribution = attributionRes.status === 'fulfilled' ? (attributionRes.value.data ?? []) : []

  // Group outbound messages per customer so we only scan a customer's own
  // messages when looking for the promise's precursor — same join logic as
  // customer-strategy-history.ts, aggregated across every customer here.
  const messagesByCustomer = new Map<string, Array<{ sent_at: string; action: string | null }>>()
  for (const m of allMessages as any[]) {
    const list = messagesByCustomer.get(m.customer_id) ?? []
    list.push({ sent_at: m.sent_at, action: m.metadata?.action_type ?? null })
    messagesByCustomer.set(m.customer_id, list)
  }

  const stats = new Map<string, { kept: number; broken: number }>()
  for (const p of promises as any[]) {
    const candidates = messagesByCustomer.get(p.customer_id) ?? []
    const promiseTime = new Date(p.created_at).getTime()
    let best: { sent_at: number; action: string } | null = null
    for (const m of candidates) {
      if (!m.action) continue
      const sentAt = new Date(m.sent_at).getTime()
      if (sentAt > promiseTime || promiseTime - sentAt > LOOKBACK_WINDOW_MS) continue
      if (!best || sentAt > best.sent_at) best = { sent_at: sentAt, action: m.action }
    }
    if (!best) continue
    const entry = stats.get(best.action) ?? { kept: 0, broken: 0 }
    if (p.status === 'kept') entry.kept++
    else entry.broken++
    stats.set(best.action, entry)
  }

  const actionRows = Array.from(stats.entries())
    .map(([action, { kept, broken }]) => ({
      action, kept, broken, total: kept + broken,
      rate: kept + broken > 0 ? Math.round((kept / (kept + broken)) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  const objectionCounts = new Map<string, number>()
  for (const d of disputes as any[]) {
    if (!d.dispute_type) continue
    objectionCounts.set(d.dispute_type, (objectionCounts.get(d.dispute_type) ?? 0) + 1)
  }
  const objectionRows = Array.from(objectionCounts.entries()).sort((a, b) => b[1] - a[1])

  const daysValues = (attribution as any[]).map(a => Number(a.days_to_collect)).filter(n => Number.isFinite(n) && n > 0)
  const avgDays = daysValues.length ? Math.round(daysValues.reduce((s, n) => s + n, 0) / daysValues.length) : null

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center gap-4 mt-6">
        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
          <TrendingUp size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">التحليل الاستراتيجي</h1>
          <p className="text-[#8b95a7] text-sm">أي أساليب الرد فعلياً ترفع نسبة الالتزام بالوعود — من بيانات حقيقية فقط، لا تخمين</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="إجمالي الوعود المحلولة" value={promises.length} sub="ملتزَم به أو منكسر" />
        <Card title="أنواع الاعتراضات المسجَّلة" value={disputes.length} />
        <Card title="متوسط أيام التحصيل" value={avgDays != null ? avgDays : '—'} sub={avgDays != null ? 'يوم' : 'لا توجد بيانات كافية'} />
      </div>

      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#222a36]">
          <h2 className="text-white font-bold">نسبة الالتزام حسب نوع الرد</h2>
          <p className="text-[#8b95a7] text-xs mt-1">لكل نوع رد أرسله الوكيل قبل وعد سداد — هل التزم العميل أو كسر وعده بعده؟</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#0b0e14] text-[#8b95a7] text-xs">
              <tr>
                <th className="text-end p-3 font-bold uppercase">نوع الرد</th>
                <th className="text-start p-3 font-bold uppercase">التزم</th>
                <th className="text-start p-3 font-bold uppercase">كسر الوعد</th>
                <th className="text-start p-3 font-bold uppercase">نسبة الالتزام</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {actionRows.map(r => (
                <tr key={r.action} className="hover:bg-[#1a212c] transition-colors text-slate-300">
                  <td className="p-3 text-white font-mono">{r.action}</td>
                  <td className="p-3 text-start text-emerald-400 font-bold">{r.kept}</td>
                  <td className="p-3 text-start text-rose-400 font-bold">{r.broken}</td>
                  <td className="p-3 text-start font-bold">{r.rate}%</td>
                </tr>
              ))}
              {actionRows.length === 0 && (
                <tr>
                  <td className="p-12 text-center bg-[#222a36]/50" colSpan={4}>
                    <div className="text-[#5f6b7e] text-sm font-bold">لا توجد بيانات كافية حتى الآن — تحتاج وعوداً محلولة (ملتزَم بها أو منكسرة) مرتبطة برد آلي سابق.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#222a36]">
          <h2 className="text-white font-bold">أكثر أنواع الاعتراضات تكراراً</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#0b0e14] text-[#8b95a7] text-xs">
              <tr>
                <th className="text-end p-3 font-bold uppercase">نوع الاعتراض</th>
                <th className="text-start p-3 font-bold uppercase">عدد المرات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {objectionRows.map(([type, count]) => (
                <tr key={type} className="hover:bg-[#1a212c] transition-colors text-slate-300">
                  <td className="p-3 text-white font-mono">{type}</td>
                  <td className="p-3 text-start font-bold">{count}</td>
                </tr>
              ))}
              {objectionRows.length === 0 && (
                <tr>
                  <td className="p-12 text-center bg-[#222a36]/50" colSpan={2}>
                    <div className="text-[#5f6b7e] text-sm font-bold">لا توجد اعتراضات مسجَّلة حالياً</div>
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
