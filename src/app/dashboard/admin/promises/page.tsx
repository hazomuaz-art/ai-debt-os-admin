import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { CheckCircle, Clock, XCircle, AlertTriangle, Calendar, User, Hash } from 'lucide-react'

const STATUS_CONFIG: Record<string, { label: string, color: string, icon: any }> = {
  pending:     { label: 'قيد الانتظار', color: 'text-yellow-600 bg-yellow-50 border-yellow-200', icon: Clock },
  kept:        { label: 'تم الالتزام', color: 'text-emerald-600 bg-emerald-50 border-emerald-200', icon: CheckCircle },
  broken:      { label: 'تم الإخلال', color: 'text-rose-600 bg-rose-50 border-rose-200', icon: XCircle },
  rescheduled: { label: 'مُعاد جدولته', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: Calendar },
  partial:     { label: 'سداد جزئي', color: 'text-amber-600 bg-amber-50 border-amber-200', icon: AlertTriangle },
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
    .order('promised_date', { ascending: false })

  const all     = promises ?? []
  const pending = all.filter(p => p.status === 'pending')
  const kept    = all.filter(p => p.status === 'kept')
  const broken  = all.filter(p => p.status === 'broken')
  const rate    = all.length ? Math.round((kept.length / all.length) * 100) : 0

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <CheckCircle size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">تتبع وعود السداد</h1>
            <p className="text-slate-500 text-sm">متابعة دقيقة لوعود العملاء وتحديث مخاطر السداد تلقائياً</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-slate-50 text-slate-500 flex items-center justify-center"><Hash size={20} /></div>
          <div><p className="text-slate-500 text-xs font-bold mb-1">إجمالي الوعود</p><p className="text-2xl font-bold text-[#1e3e50]">{all.length}</p></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-yellow-50 text-yellow-600 flex items-center justify-center"><Clock size={20} /></div>
          <div><p className="text-yellow-600 text-xs font-bold mb-1">قيد الانتظار</p><p className="text-2xl font-bold text-yellow-600">{pending.length}</p></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center"><CheckCircle size={20} /></div>
          <div><p className="text-emerald-600 text-xs font-bold mb-1">تم الالتزام</p><p className="text-2xl font-bold text-emerald-600">{kept.length}</p></div>
        </div>
        <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center"><AlertTriangle size={20} /></div>
          <div><p className="text-indigo-600 text-xs font-bold mb-1">نسبة الالتزام</p><p className="text-2xl font-bold text-indigo-600">{rate}%</p></div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-[#f0f4f8] text-slate-500 border-b border-slate-100 text-xs">
              <tr>
                <th className="py-4 px-6 font-bold uppercase">العميل</th>
                <th className="py-4 px-6 font-bold uppercase">المرجع</th>
                <th className="py-4 px-6 font-bold uppercase">المبلغ الموعود</th>
                <th className="py-4 px-6 font-bold uppercase">تاريخ الوعد</th>
                <th className="py-4 px-6 font-bold uppercase">القناة</th>
                <th className="py-4 px-6 font-bold uppercase">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {all.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 bg-slate-50/50">
                    <div className="text-slate-400 text-sm font-bold">لا توجد وعود مسجّلة حالياً</div>
                  </td>
                </tr>
              )}
              {all.map((p: any) => {
                const conf = STATUS_CONFIG[p.status] || STATUS_CONFIG.pending;
                const StatusIcon = conf.icon;
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center"><User size={14} /></div>
                        <div>
                          <p className="font-bold text-[#1e3e50]">{p.customer?.full_name ?? '—'}</p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{p.customer?.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-mono text-xs font-bold text-slate-500 bg-slate-50/50">{p.debt?.reference_number ?? '—'}</td>
                    <td className="py-4 px-6 font-bold font-mono text-[#1e3e50]">{formatCurrency(p.promised_amount, p.debt?.currency ?? 'SAR')}</td>
                    <td className="py-4 px-6 text-slate-500 font-medium">{formatDate(p.promised_date)}</td>
                    <td className="py-4 px-6 text-slate-500 text-xs">
                      <span className="bg-slate-100 px-2 py-1 rounded-md">{p.channel}</span>
                    </td>
                    <td className="py-4 px-6">
                      <span className={`flex items-center gap-1.5 w-fit px-3 py-1.5 rounded-lg text-xs font-bold border ${conf.color}`}>
                        <StatusIcon size={14} />
                        {conf.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
