import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import type { SystemConfig } from '@/types'

export default async function VoicePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/admin')

  const { data: config } = await supabase.from('system_config').select('*').eq('company_id', profile.company_id).maybeSingle()
  const { data: sessions } = await supabase.from('voice_sessions').select('status, outcome, duration_seconds, cost_usd').eq('company_id', profile.company_id).limit(500)

  const s = sessions ?? []
  const stats = {
    planned:      s.length,
    successful:   s.filter(x => x.status === 'completed').length,
    promises:     s.filter(x => x.outcome === 'promise_to_pay').length,
    refused:      s.filter(x => x.outcome === 'refused').length,
    avg_duration: s.length ? Math.round(s.reduce((a, x) => a + (x.duration_seconds ?? 0), 0) / s.length) : 0,
    total_cost:   s.reduce((a, x) => a + Number(x.cost_usd ?? 0), 0),
  }

  const cfg = config as SystemConfig | null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">AI Voice Collector</h1>
        <p className="text-white/40 text-sm mt-0.5">جاهز للربط مع Tameez — لا مكالمات حقيقية حتى تفعيل LIVE Mode</p>
      </div>

      <div className="card p-4 border-yellow-500/20 bg-yellow-500/5 flex items-center gap-3">
        <span className="text-yellow-400 text-lg">⚠</span>
        <div>
          <div className="text-yellow-400 text-sm font-medium">الموديول في وضع الإعداد</div>
          <p className="text-white/40 text-xs mt-0.5">ربط Tameez أو Twilio مطلوب من صفحة Integrations لبدء المكالمات الفعلية</p>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
        {[
          { label: 'مخطط',      val: stats.planned,     color: '' },
          { label: 'ناجح',       val: stats.successful,  color: 'text-green-400' },
          { label: 'وعود سداد', val: stats.promises,    color: 'text-brand-400' },
          { label: 'رافض',       val: stats.refused,     color: 'text-red-400' },
          { label: 'متوسط المدة',val: `${stats.avg_duration}s`, color: '' },
          { label: 'التكلفة',   val: `$${stats.total_cost.toFixed(4)}`, color: 'text-yellow-400' },
        ].map(({ label, val, color }) => (
          <div key={label} className="stat-card">
            <div className="text-white/40 text-xs">{label}</div>
            <div className={`font-display text-xl font-bold ${color}`}>{val}</div>
          </div>
        ))}
      </div>

      <div className="card p-5 space-y-4">
        <div className="font-display font-semibold text-sm">إعدادات الشخصية الصوتية</div>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'اسم الشخصية', key: 'voice_agent_name', val: cfg?.voice_agent_name ?? 'AI Collector' },
            { label: 'اللهجة',      key: 'voice_dialect',    val: cfg?.voice_dialect    ?? 'Saudi' },
            { label: 'بداية الاتصال',key: 'call_hours_start',val: cfg?.call_hours_start ?? '09:00' },
            { label: 'نهاية الاتصال',key: 'call_hours_end',  val: cfg?.call_hours_end   ?? '18:00' },
            { label: 'الحد اليومي', key: 'daily_call_limit', val: String(cfg?.daily_call_limit ?? 50) },
          ].map(({ label, key, val }) => (
            <div key={key}>
              <label className="label">{label}</label>
              <div className="input text-sm text-white/50 cursor-not-allowed">{val}</div>
            </div>
          ))}
        </div>
        <p className="text-white/30 text-xs">لتعديل الإعدادات، استخدم صفحة <strong>Automation Control</strong></p>
      </div>

      <div className="card p-5">
        <div className="font-display font-semibold text-sm mb-4">آخر الجلسات الصوتية</div>
        {s.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-8">لا توجد جلسات مسجّلة</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-white/30 text-xs border-b border-white/5">
              <th className="pb-2 text-left">الحالة</th>
              <th className="pb-2 text-left">النتيجة</th>
              <th className="pb-2 text-left">المدة</th>
              <th className="pb-2 text-left">التكلفة</th>
            </tr></thead>
            <tbody>{s.slice(0, 20).map((sess, i) => (
              <tr key={i} className="border-b border-white/5">
                <td className="py-2 text-white/60">{sess.status}</td>
                <td className="py-2 text-white/60">{sess.outcome ?? '—'}</td>
                <td className="py-2 text-white/40">{sess.duration_seconds ?? 0}s</td>
                <td className="py-2 font-mono text-xs text-white/40">${Number(sess.cost_usd).toFixed(4)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}
