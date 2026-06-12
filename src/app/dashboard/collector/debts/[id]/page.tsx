import { createClient } from '@/lib/supabase/server'
import { notFound, redirect } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import RecordPaymentModal from '@/components/debt/RecordPaymentModal'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'
import Link from 'next/link'
import { ArrowRight, User, Wallet, Phone, MessageCircle, AlertTriangle, FileText, CheckCircle2, History, MapPin, Building, CreditCard, Sparkles } from 'lucide-react'

export default async function CollectorDebtDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: debt } = await supabase
    .from('debts')
    .select(`
      *,
      customer:customers(*),
      payments(*),
      messages(*),
      ai_scores(*)
    `)
    .eq('id', params.id)
    .eq('assigned_to', user.id)
    .single()

  if (!debt) notFound()

  const latestScore = (debt.ai_scores as any[])?.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0]

  const totalPaid = (debt.payments as any[])?.reduce((sum, p) => sum + Number(p.amount), 0) ?? 0
  const customer = debt.customer as any

  const getStatusLabel = (s: string) => {
    const labels: Record<string, string> = {
      active: 'نشط', promised: 'وعد سداد', disputed: 'معترض', partial: 'سداد جزئي', settled: 'مسدد بالكامل'
    }
    return labels[s] ?? s
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      
      {/* Header Toolbar */}
      <div className="flex items-center justify-between mt-6 mb-2">
        <Link href="/dashboard/collector/debts" className="flex items-center gap-2 text-slate-500 hover:text-blue-600 font-bold text-sm bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-100 transition-colors">
          <ArrowRight size={16} /> العودة للقائمة
        </Link>
        <div className="flex items-center gap-3">
          <SendWhatsAppButton
            debtId={debt.id}
            phone={customer?.whatsapp || customer?.phone}
            customerName={customer?.full_name}
          />
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Right Column (Wider) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Debt Overview Card */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-1.5 h-full bg-blue-500 rounded-r-2xl"></div>
            
            <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                  <Wallet size={20} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-[#1e3e50]">تفاصيل المديونية</h2>
                  <p className="text-slate-400 text-xs font-mono mt-0.5">{debt.reference_number}</p>
                </div>
              </div>
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#f0f4f8] text-slate-600 border border-slate-200">
                الحالة: {getStatusLabel(debt.status as string)}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 text-sm">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                <p className="text-slate-500 font-bold text-xs mb-1">المبلغ الأصلي</p>
                <p className="text-lg font-bold text-[#1e3e50] font-mono">{formatCurrency(debt.original_amount, debt.currency)}</p>
              </div>
              <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                <p className="text-blue-600 font-bold text-xs mb-1">الرصيد المتبقي</p>
                <p className="text-lg font-bold text-blue-700 font-mono">{formatCurrency(debt.current_balance, debt.currency)}</p>
              </div>
              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                <p className="text-emerald-600 font-bold text-xs mb-1">إجمالي المسدد</p>
                <p className="text-lg font-bold text-emerald-700 font-mono">{formatCurrency(totalPaid, debt.currency)}</p>
              </div>
              <div className="bg-amber-50 p-3 rounded-xl border border-amber-100">
                <p className="text-amber-600 font-bold text-xs mb-1">تاريخ الاستحقاق</p>
                <p className="text-lg font-bold text-amber-700">{formatDate(debt.due_date)}</p>
              </div>
            </div>

            {debt.notes && (
              <div className="mt-6 p-4 bg-[#fcfdfd] border border-slate-100 rounded-xl">
                <p className="text-slate-500 font-bold text-xs flex items-center gap-1.5 mb-2"><FileText size={14} /> ملاحظات الملف</p>
                <p className="text-slate-700 text-sm leading-relaxed">{debt.notes as string}</p>
              </div>
            )}
          </div>

          {/* Payments History Card */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-6 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                  <CreditCard size={20} />
                </div>
                <h2 className="text-lg font-bold text-[#1e3e50]">سجل الدفعات</h2>
              </div>
              <RecordPaymentModal debtId={debt.id} currentBalance={Number(debt.current_balance)} currency={debt.currency as string} />
            </div>

            {(debt.payments as any[])?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-right">
                  <thead className="bg-[#fbfdfd] border-b border-slate-100 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-bold">التاريخ</th>
                      <th className="px-4 py-3 font-bold">المبلغ</th>
                      <th className="px-4 py-3 font-bold">طريقة الدفع</th>
                      <th className="px-4 py-3 font-bold">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(debt.payments as any[]).map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3 text-slate-600 font-medium">{formatDate(p.payment_date)}</td>
                        <td className="px-4 py-3 font-bold text-emerald-600 font-mono">{formatCurrency(p.amount, debt.currency as string)}</td>
                        <td className="px-4 py-3 text-slate-500">
                          <span className="bg-slate-100 px-2.5 py-1 rounded-md text-[11px] font-bold">{p.payment_method || '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{p.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-12 h-12 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-3">
                  <History size={20} />
                </div>
                <p className="text-slate-500 font-bold text-sm">لم يتم تسجيل أي دفعات حتى الآن</p>
              </div>
            )}
          </div>

          {/* Messages Timeline */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
              <div className="w-10 h-10 bg-slate-100 text-slate-600 rounded-xl flex items-center justify-center">
                <MessageCircle size={20} />
              </div>
              <h2 className="text-lg font-bold text-[#1e3e50]">سجل المراسلات</h2>
            </div>

            {(debt.messages as any[])?.length > 0 ? (
              <div className="space-y-4 max-h-96 overflow-y-auto pr-2">
                {(debt.messages as any[]).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map((msg) => (
                  <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm ${
                      msg.direction === 'outbound' 
                        ? 'bg-blue-600 text-white rounded-tr-sm shadow-sm' 
                        : 'bg-slate-100 text-slate-800 rounded-tl-sm border border-slate-200'
                    }`}>
                      <p className="leading-relaxed">{msg.content}</p>
                      <p className={`text-[10px] mt-2 font-bold ${msg.direction === 'outbound' ? 'text-blue-200' : 'text-slate-400'}`}>
                        {formatDate(msg.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 bg-slate-50 rounded-xl border border-slate-100 border-dashed">
                <MessageCircle size={24} className="text-slate-300 mx-auto mb-2" />
                <p className="text-slate-500 font-bold text-sm">لا توجد رسائل سابقة مع هذا العميل</p>
              </div>
            )}
          </div>

        </div>

        {/* Left Column (Narrower) */}
        <div className="space-y-6">
          
          {/* Customer Profile Card */}
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm relative overflow-hidden">
            <div className="absolute top-0 right-0 w-full h-1.5 bg-slate-800"></div>
            
            <div className="text-center mb-6 pt-2">
              <div className="w-20 h-20 bg-[#f0f4f8] text-[#1e3e50] rounded-full flex items-center justify-center mx-auto mb-3 border-[4px] border-white shadow-sm">
                <User size={32} />
              </div>
              <h2 className="text-lg font-bold text-[#1e3e50]">{customer?.full_name}</h2>
              <p className="text-slate-400 text-xs font-medium mt-1">العميل المدين</p>
            </div>

            <div className="space-y-4 text-sm bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="flex items-start gap-3">
                <Phone size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-slate-400 text-xs font-bold mb-0.5">رقم الجوال</p>
                  <p className="font-bold text-[#1e3e50] font-mono" dir="ltr">{customer?.phone || '—'}</p>
                </div>
              </div>
              <div className="w-full h-px bg-slate-200"></div>
              <div className="flex items-start gap-3">
                <MessageCircle size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-slate-400 text-xs font-bold mb-0.5">رقم الواتساب</p>
                  <p className="font-bold text-[#1e3e50] font-mono" dir="ltr">{customer?.whatsapp || '—'}</p>
                </div>
              </div>
              <div className="w-full h-px bg-slate-200"></div>
              <div className="flex items-start gap-3">
                <MapPin size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-slate-400 text-xs font-bold mb-0.5">المدينة / العنوان</p>
                  <p className="font-bold text-[#1e3e50]">{customer?.city || '—'}</p>
                </div>
              </div>
              <div className="w-full h-px bg-slate-200"></div>
              <div className="flex items-start gap-3">
                <Building size={16} className="text-slate-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-slate-400 text-xs font-bold mb-0.5">جهة العمل</p>
                  <p className="font-bold text-[#1e3e50]">{customer?.employer || '—'}</p>
                </div>
              </div>
              {customer?.monthly_income && (
                <>
                  <div className="w-full h-px bg-slate-200"></div>
                  <div className="flex items-start gap-3">
                    <Wallet size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-slate-400 text-xs font-bold mb-0.5">الدخل الشهري</p>
                      <p className="font-bold text-emerald-600 font-mono">{formatCurrency(customer.monthly_income, debt.currency as string)}</p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* AI Score Card */}
          {latestScore && (
            <div className="bg-gradient-to-br from-[#1e3e50] to-slate-900 rounded-2xl p-6 shadow-md text-white relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
              
              <div className="flex items-center gap-2 mb-4 text-brand-300 font-bold text-sm relative z-10">
                <Sparkles size={16} /> تقييم الذكاء الاصطناعي
              </div>
              
              <div className="flex items-center gap-4 mb-5 relative z-10">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold font-mono border-[3px] shadow-inner ${
                  latestScore.score >= 70 ? 'border-emerald-400 text-emerald-400 bg-emerald-400/10' : 
                  latestScore.score >= 40 ? 'border-amber-400 text-amber-400 bg-amber-400/10' : 
                  'border-rose-400 text-rose-400 bg-rose-400/10'
                }`}>
                  {latestScore.score}
                </div>
                <div>
                  <p className="text-lg font-bold mb-1">{latestScore.risk_classification}</p>
                  <p className="text-xs text-slate-300 bg-white/10 px-2 py-1 rounded-md inline-block">
                    احتمالية التحصيل: {Math.round(latestScore.collection_probability * 100)}%
                  </p>
                </div>
              </div>
              
              <div className="bg-white/10 p-4 rounded-xl border border-white/5 relative z-10 backdrop-blur-sm">
                <p className="text-xs font-bold text-brand-200 mb-1">الاستراتيجية الموصى بها:</p>
                <p className="text-sm text-slate-100 leading-relaxed">{latestScore.recommended_strategy}</p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
