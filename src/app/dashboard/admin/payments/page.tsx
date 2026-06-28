import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Wallet, CheckCircle, Clock, User, Hash, Download, FileSpreadsheet } from 'lucide-react'

const VERIFICATION_CONFIG: Record<string, { label: string; color: string }> = {
  verified:            { label: 'موثَّق', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  pending_verification: { label: 'قيد المراجعة', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
  pending:             { label: 'قيد المراجعة', color: 'text-yellow-600 bg-yellow-50 border-yellow-200' },
}

export default async function PaymentsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const { data: profile } = await supabase.from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!profile?.company_id) redirect('/login')

  const { data: payments } = await supabase
    .from('payments')
    .select('*, customer:customers(full_name, phone, whatsapp), debt:debts(reference_number, currency)')
    .eq('company_id', profile.company_id)
    .order('payment_date', { ascending: false })
    .limit(300)

  const all = payments ?? []
  const totalAmount = all.reduce((sum, p: any) => sum + Number(p.amount ?? 0), 0)
  const verified = all.filter((p: any) => p.verification_status === 'verified')
  const pendingReview = all.filter((p: any) => p.verification_status !== 'verified')

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <Wallet size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">المدفوعات</h1>
            <p className="text-[#8b95a7] text-sm">كل المدفوعات المسجَّلة مع تفاصيلها الكاملة والإيصالات الأصلية</p>
          </div>
        </div>
        <a
          href="/api/payments/export"
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors"
        >
          <FileSpreadsheet size={16} /> تصدير تقرير CSV
        </a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-[#151a23] p-6 rounded-2xl border border-[#222a36] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-[#222a36] text-[#8b95a7] flex items-center justify-center"><Hash size={20} /></div>
          <div><p className="text-[#8b95a7] text-xs font-bold mb-1">إجمالي المبلغ المسدَّد</p><p className="text-2xl font-bold text-white">{formatCurrency(totalAmount, 'SAR')}</p></div>
        </div>
        <div className="bg-[#151a23] p-6 rounded-2xl border border-[#222a36] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center"><CheckCircle size={20} /></div>
          <div><p className="text-emerald-600 text-xs font-bold mb-1">موثَّقة</p><p className="text-2xl font-bold text-emerald-600">{verified.length}</p></div>
        </div>
        <div className="bg-[#151a23] p-6 rounded-2xl border border-[#222a36] shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-yellow-50 text-yellow-600 flex items-center justify-center"><Clock size={20} /></div>
          <div><p className="text-yellow-600 text-xs font-bold mb-1">قيد المراجعة</p><p className="text-2xl font-bold text-yellow-600">{pendingReview.length}</p></div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead className="bg-[#0b0e14] text-[#8b95a7] border-b border-[#222a36] text-xs">
              <tr>
                <th className="py-4 px-6 font-bold uppercase">العميل</th>
                <th className="py-4 px-6 font-bold uppercase">المرجع</th>
                <th className="py-4 px-6 font-bold uppercase">المبلغ</th>
                <th className="py-4 px-6 font-bold uppercase">تاريخ السداد</th>
                <th className="py-4 px-6 font-bold uppercase">طريقة الدفع</th>
                <th className="py-4 px-6 font-bold uppercase">حالة التحقق</th>
                <th className="py-4 px-6 font-bold uppercase">الإيصال</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1c2330]">
              {all.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-12 bg-[#222a36]/50">
                    <div className="text-[#5f6b7e] text-sm font-bold">لا توجد مدفوعات مسجَّلة حالياً</div>
                  </td>
                </tr>
              )}
              {all.map((p: any) => {
                const conf = VERIFICATION_CONFIG[p.verification_status] ?? VERIFICATION_CONFIG.pending
                return (
                  <tr key={p.id} className="hover:bg-[#1a212c] transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#222a36] text-[#8b95a7] flex items-center justify-center"><User size={14} /></div>
                        <div>
                          <p className="font-bold text-white">{p.customer?.full_name ?? '—'}</p>
                          <p className="text-xs text-[#5f6b7e] font-mono mt-0.5">{p.customer?.whatsapp || p.customer?.phone}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-mono text-xs font-bold text-[#8b95a7] bg-[#222a36]/50">{p.debt?.reference_number ?? '—'}</td>
                    <td className="py-4 px-6 font-bold font-mono text-emerald-400">{formatCurrency(p.amount, p.debt?.currency ?? p.currency ?? 'SAR')}</td>
                    <td className="py-4 px-6 text-[#8b95a7] font-medium">{formatDate(p.payment_date)}</td>
                    <td className="py-4 px-6 text-[#8b95a7]">{p.payment_method || '—'}</td>
                    <td className="py-4 px-6">
                      <span className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${conf.color}`}>{conf.label}</span>
                    </td>
                    <td className="py-4 px-6">
                      {p.receipt_url ? (
                        <a
                          href={`/api/payments/${p.id}/receipt`}
                          target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 text-indigo-400 hover:text-indigo-300 text-xs font-bold"
                        >
                          <Download size={14} /> تنزيل
                        </a>
                      ) : (
                        <span className="text-[#5f6b7e] text-xs">—</span>
                      )}
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
