import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'

const STATUS_STYLES: Record<string, string> = {
  pending:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  kept:        'bg-green-500/10  text-green-400  border-green-500/20',
  broken:      'bg-red-500/10    text-red-400    border-red-500/20',
  rescheduled: 'bg-blue-500/10   text-blue-400   border-blue-500/20',
  partial:     'bg-orange-500/10 text-orange-400 border-orange-500/20',
}

export default async function PromisesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id) redirect('/login')

  const { data: promises } = await supabase
    .from('promises')
    .select('*, customer:customers(full_name, phone), debt:debts(reference_number, currency)')
    .eq('company_id', profile.company_id)
    .order('promised_date')

  const all     = promises ?? []
  const pending = all.filter(p => p.status === 'pending')
  const kept    = all.filter(p => p.status === 'kept')
  const broken  = all.filter(p => p.status === 'broken')
  const rate    = all.length ? Math.round((kept.length / all.length) * 100) : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Promise-to-Pay Tracker</h1>
        <p className="text-white/40 text-sm mt-0.5">تتبع وعود السداد وتحديث Risk Score تلقائياً</p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card"><div className="text-white/40 text-xs">الكل</div>
          <div className="font-display text-2xl font-bold">{all.length}</div></div>
        <div className="stat-card"><div className="text-white/40 text-xs">انتظار</div>
          <div className="font-display text-2xl font-bold text-yellow-400">{pending.length}</div></div>
        <div className="stat-card"><div className="text-white/40 text-xs">التزام</div>
          <div className="font-display text-2xl font-bold text-green-400">{kept.length}</div></div>
        <div className="stat-card"><div className="text-white/40 text-xs">نسبة الالتزام</div>
          <div className="font-display text-2xl font-bold text-brand-400">{rate}%</div></div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-white/30 text-xs border-b border-white/5">
            <th className="p-3 text-left">العميل</th>
            <th className="p-3 text-left">المرجع</th>
            <th className="p-3 text-left">المبلغ الموعود</th>
            <th className="p-3 text-left">تاريخ الوعد</th>
            <th className="p-3 text-left">القناة</th>
            <th className="p-3 text-left">الحالة</th>
          </tr></thead>
          <tbody>
            {all.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-white/30">لا توجد وعود مسجّلة</td></tr>
            )}
            {all.map((p: any) => (
              <tr key={p.id} className="border-b border-white/5 last:border-0">
                <td className="p-3 font-medium">{p.customer?.full_name ?? '—'}</td>
                <td className="p-3 font-mono text-xs text-white/50">{p.debt?.reference_number ?? '—'}</td>
                <td className="p-3">{formatCurrency(p.promised_amount, p.debt?.currency ?? 'SAR')}</td>
                <td className="p-3 text-white/60">{formatDate(p.promised_date)}</td>
                <td className="p-3 text-white/50">{p.channel}</td>
                <td className="p-3">
                  <span className={`status-badge text-[10px] ${STATUS_STYLES[p.status] ?? ''}`}>{p.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
