import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/utils'
import RecordPaymentModal from '@/components/debt/RecordPaymentModal'
import UpdateDebtStatusSelect from '@/components/debt/UpdateDebtStatusSelect'
import ScoreDebtButton from '@/components/ai/ScoreDebtButton'
import EditDebtModal from '@/components/debt/EditDebtModal'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'
import AssignDebtSelect from '@/components/debt/AssignDebtSelect'
import Link from 'next/link'
import { ArrowRight, User, CreditCard, Activity, MessageSquare, History, ShieldAlert, CheckCircle, BrainCircuit, Wallet, Calendar, AlertTriangle, FileText, BellRing, Target } from 'lucide-react'
import QuickActionsPanel from '@/components/debt/QuickActionsPanel'
import CollectorNotePanel from '@/components/debt/CollectorNotePanel'

export default async function DebtDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  const { data: debt } = await supabase
    .from('debts')
    .select(`
      *,
      customer:customers(*),
      assigned_to_profile:profiles!debts_assigned_to_fkey(full_name, email),
      payments(*),
      messages(*),
      ai_scores(*)
    `)
    .eq('id', params.id)
    .single()

  if (!debt) notFound()

  const { data: collectors } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('role', ['collector', 'manager'])
    .order('full_name')

  const latestScore = debt.ai_scores?.sort((a: any, b: any) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )[0]

  const { data: aiActions } = await supabase
    .from('ai_actions')
    .select('id, action_type, priority, reason, suggested_message, status, created_at')
    .eq('debt_id', debt.id)
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: debtAlerts } = await supabase
    .from('system_alerts')
    .select('id, severity, alert_type, title, message, is_resolved, created_at')
    .eq('is_resolved', false)
    .contains('metadata', { debt_id: debt.id })
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: timelineEvents } = await supabase
    .from('timeline_events')
    .select('id, event_type, channel, summary, detail, occurred_at')
    .eq('debt_id', debt.id)
    .order('occurred_at', { ascending: false })
    .limit(8)

  const { data: promises } = await supabase
    .from('promises')
    .select('id, promised_amount, promised_date, status, channel, notes, created_at')
    .eq('debt_id', debt.id)
    .order('promised_date', { ascending: false })
    .limit(5)

  const { data: approvals } = await supabase
    .from('approvals')
    .select('id, approval_type, status, priority, reason, created_at')
    .eq('entity_id', debt.id)
    .order('created_at', { ascending: false })
    .limit(5)

  const { data: memoryEntries } = await supabase
    .from('ai_memory')
    .select('id, trigger_pattern, response_text, category, success_rate, use_count, created_at')
    .eq('is_active', true)
    .neq('source', 'imported')
    .order('use_count', { ascending: false })
    .limit(5)

  const { data: collectionFollowups } = await supabase
    .from('collection_followups')
    .select('id, original_status, original_sub_status, normalized_status, collector_name, customer_statement, collector_note, result_summary, occurred_at')
    .eq('debt_id', debt.id)
    .order('occurred_at', { ascending: false })
    .limit(8)

  const { data: collectionStatusHistory } = await supabase
    .from('collection_status_history')
    .select('id, old_status, old_sub_status, new_status, new_sub_status, normalized_status, changed_by_name, changed_at')
    .eq('debt_id', debt.id)
    .order('changed_at', { ascending: false })
    .limit(8)

  const { data: collectionAssignments } = await supabase
    .from('collection_assignments')
    .select('id, assigned_to_name, assigned_by_name, assignment_status, assigned_at, released_at')
    .eq('debt_id', debt.id)
    .order('assigned_at', { ascending: false })
    .limit(5)

  const totalPaid = debt.payments?.reduce((sum: number, p: any) => sum + Number(p.amount), 0) ?? 0

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/admin/debts" className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-500 hover:bg-slate-100 hover:text-[#1e3e50] transition-colors">
            <ArrowRight size={20} />
          </Link>
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <User size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">{debt.customer?.full_name}</h1>
            <p className="text-slate-500 text-sm font-mono" dir="ltr">{debt.reference_number}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <EditDebtModal debt={debt} customer={debt.customer} />
          <ScoreDebtButton debtId={debt.id} />
          <SendWhatsAppButton
            debtId={debt.id}
            phone={debt.customer?.whatsapp || debt.customer?.phone}
            customerName={debt.customer?.full_name}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Info (Right Column in RTL) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Quick Actions Panel */}
          <QuickActionsPanel debtId={debt.id} currentStatus={debt.status} />

          {/* Debt Overview */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-5">
              <CreditCard className="text-[#1e3e50]" size={20} />
              <h2 className="text-lg font-bold text-[#1e3e50]">نظرة عامة على المديونية</h2>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                <p className="text-slate-500 text-xs font-bold mb-1">المبلغ الأساسي</p>
                <p className="text-xl font-bold text-[#1e3e50]">{formatCurrency(debt.original_amount, debt.currency)}</p>
              </div>
              <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <p className="text-indigo-600 text-xs font-bold mb-1">الرصيد المتبقي</p>
                <p className="text-xl font-bold text-indigo-700">{formatCurrency(debt.current_balance, debt.currency)}</p>
              </div>
              <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100">
                <p className="text-emerald-600 text-xs font-bold mb-1">إجمالي المسدد</p>
                <p className="text-xl font-bold text-emerald-700">{formatCurrency(totalPaid, debt.currency)}</p>
              </div>
              <div className="bg-rose-50 p-4 rounded-xl border border-rose-100">
                <p className="text-rose-600 text-xs font-bold mb-1">تاريخ الاستحقاق</p>
                <p className="text-lg font-bold text-rose-700">{formatDate(debt.due_date)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
              <div>
                <p className="text-slate-500 text-sm font-bold mb-2">حالة المديونية</p>
                <UpdateDebtStatusSelect debtId={debt.id} currentStatus={debt.status} />
              </div>
              <div>
                <p className="text-slate-500 text-sm font-bold mb-2">الأولوية</p>
                <span className={`inline-flex px-3 py-1.5 rounded-lg text-sm font-bold border ${
                  debt.priority === 'critical' ? 'bg-rose-50 text-rose-600 border-rose-200' :
                  debt.priority === 'high' ? 'bg-orange-50 text-orange-600 border-orange-200' :
                  debt.priority === 'medium' ? 'bg-yellow-50 text-yellow-600 border-yellow-200' :
                  'bg-slate-50 text-slate-600 border-slate-200'
                }`}>
                  {debt.priority === 'critical' ? 'حرج جداً' :
                   debt.priority === 'high' ? 'مرتفع' :
                   debt.priority === 'medium' ? 'متوسط' : 'منخفض'}
                </span>
              </div>
            </div>
            {debt.description && (
              <div className="mt-6 pt-6 border-t border-slate-100">
                <p className="text-slate-500 text-sm font-bold mb-2">الوصف وملاحظات الدين</p>
                <p className="text-slate-700 leading-relaxed bg-[#fbfdfd] p-4 rounded-xl border border-slate-100">{debt.description}</p>
              </div>
            )}
          </div>

          {/* Collector Note & Follow-up */}
          <CollectorNotePanel 
            debtId={debt.id} 
            currentNote={debt.notes} 
            currentFollowUpDate={debt.next_follow_up} 
          />

          {/* Payment History */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-5">
              <div className="flex items-center gap-2">
                <Wallet className="text-emerald-600" size={20} />
                <h2 className="text-lg font-bold text-[#1e3e50]">سجل المدفوعات</h2>
              </div>
              <RecordPaymentModal
                debtId={debt.id}
                currentBalance={debt.current_balance}
                currency={debt.currency}
              />
            </div>
            {debt.payments?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-right text-sm">
                  <thead>
                    <tr className="text-slate-500 bg-slate-50">
                      <th className="p-3 rounded-r-xl font-bold">التاريخ</th>
                      <th className="p-3 font-bold">المبلغ</th>
                      <th className="p-3 font-bold">طريقة الدفع</th>
                      <th className="p-3 font-bold">المرجع</th>
                      <th className="p-3 rounded-l-xl font-bold">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {debt.payments.map((p: any) => (
                      <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 text-slate-600">{formatDate(p.payment_date)}</td>
                        <td className="p-3 font-bold text-emerald-600">{formatCurrency(p.amount, debt.currency)}</td>
                        <td className="p-3 text-slate-600">{p.payment_method || '—'}</td>
                        <td className="p-3 text-slate-500 font-mono text-xs">{p.reference_number || '—'}</td>
                        <td className="p-3 text-slate-500">{p.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400 font-bold bg-slate-50/50 rounded-xl border border-slate-100 border-dashed">
                لم يتم تسجيل أي مدفوعات حتى الآن
              </div>
            )}
          </div>

          {/* Message History */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-5">
              <MessageSquare className="text-blue-500" size={20} />
              <h2 className="text-lg font-bold text-[#1e3e50]">سجل المراسلات</h2>
            </div>
            {debt.messages?.length > 0 ? (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                {debt.messages.map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-xs lg:max-w-md px-5 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      msg.direction === 'outbound'
                        ? 'bg-[#1e3e50] text-white rounded-tr-none'
                        : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
                    }`}>
                      <p>{msg.content}</p>
                      <p className={`text-[10px] mt-2 font-bold ${msg.direction === 'outbound' ? 'text-slate-400' : 'text-slate-400'}`}>
                        {formatDate(msg.sent_at || msg.created_at)} • {msg.channel}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400 font-bold bg-slate-50/50 rounded-xl border border-slate-100 border-dashed">
                لا توجد رسائل مسجلة
              </div>
            )}
          </div>
          
          {/* Timeline Events */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-5">
              <History className="text-purple-500" size={20} />
              <h2 className="text-lg font-bold text-[#1e3e50]">الخط الزمني المباشر (Timeline)</h2>
            </div>
            {timelineEvents?.length ? (
              <div className="space-y-6 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                {timelineEvents.map((ev: any) => (
                  <div key={ev.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-slate-100 text-slate-500 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <Activity size={16} />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-slate-100 bg-white shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-[#1e3e50] text-sm">{ev.summary}</span>
                        <span className="text-[10px] bg-slate-50 text-slate-500 px-2 py-0.5 rounded-md border border-slate-100">{ev.channel || 'نظام'}</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-2 font-mono" dir="ltr">{new Date(ev.occurred_at).toLocaleString('ar-SA')}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-center py-8 font-bold bg-slate-50/50 rounded-xl border border-slate-100 border-dashed">لا توجد أحداث مسجلة</p>
            )}
          </div>
        </div>

        {/* Sidebar (Left Column in RTL) */}
        <div className="space-y-6">
          
          {/* Customer Info */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4 mb-4">
              <User className="text-[#1e3e50]" size={20} />
              <h2 className="text-lg font-bold text-[#1e3e50]">بيانات العميل</h2>
            </div>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-slate-500 font-bold">الاسم</span>
                <span className="font-bold text-[#1e3e50]">{debt.customer?.full_name}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-slate-500 font-bold">الهاتف</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold font-mono text-[#1e3e50]" dir="ltr">{debt.customer?.phone || '—'}</span>
                  {debt.customer?.phone && <SendWhatsAppButton debtId={debt.id} phone={debt.customer.phone} customerName={debt.customer.full_name} small />}
                </div>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-slate-500 font-bold">واتساب</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold font-mono text-[#1e3e50]" dir="ltr">{debt.customer?.whatsapp || '—'}</span>
                  {debt.customer?.whatsapp && <SendWhatsAppButton debtId={debt.id} phone={debt.customer.whatsapp} customerName={debt.customer.full_name} small />}
                </div>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-slate-500 font-bold">رقم الحساب / العقد</span>
                <span className="font-bold font-mono text-[#1e3e50]">{debt.account_number || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-slate-500 font-bold">نوع المنتج</span>
                <span className="font-bold text-[#1e3e50]">{debt.product_type || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-slate-500 font-bold">الهوية الوطنية</span>
                <span className="font-bold font-mono text-[#1e3e50]">{debt.customer?.national_id || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-slate-500 font-bold">المدينة</span>
                <span className="font-bold text-[#1e3e50]">{debt.customer?.city || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-slate-500 font-bold">جهة العمل</span>
                <span className="font-bold text-[#1e3e50]">{debt.customer?.employer || '—'}</span>
              </div>
              {debt.customer?.monthly_income && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-bold">الدخل الشهري</span>
                  <span className="font-bold text-emerald-600">{formatCurrency(debt.customer.monthly_income, debt.currency)}</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <h2 className="text-sm font-bold text-slate-500 mb-3">المحصّل المسؤول</h2>
            <AssignDebtSelect
              debtId={debt.id}
              currentAssigneeId={debt.assigned_to as string | null}
              collectors={collectors ?? []}
            />
          </div>

          {/* AI Score */}
          <div className="bg-gradient-to-br from-indigo-50 to-white rounded-2xl p-6 shadow-sm border border-indigo-100">
            <div className="flex items-center gap-2 border-b border-indigo-100/50 pb-4 mb-4">
              <BrainCircuit className="text-indigo-600" size={20} />
              <h2 className="text-lg font-bold text-indigo-900">تقييم الذكاء الاصطناعي</h2>
            </div>
            {latestScore ? (
              <div className="space-y-5">
                <div className="flex items-center justify-center gap-4 py-2">
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 shadow-sm bg-white ${
                    latestScore.score >= 70 ? 'border-emerald-400 text-emerald-600' :
                    latestScore.score >= 40 ? 'border-amber-400 text-amber-600' : 'border-rose-400 text-rose-600'
                  }`}>
                    <span className="text-4xl font-bold font-mono">{latestScore.score}</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-[#1e3e50] mb-1">{latestScore.risk_classification}</p>
                    <p className="text-xs text-slate-500 flex items-center gap-1">
                      <Target size={12} className="text-indigo-400" />
                      احتمالية التحصيل: <strong className="text-[#1e3e50]">{Math.round(latestScore.collection_probability * 100)}%</strong>
                    </p>
                  </div>
                </div>
                
                <div className="bg-white rounded-xl p-4 border border-indigo-50 shadow-sm">
                  <p className="text-xs text-indigo-400 font-bold mb-1">الاستراتيجية المقترحة</p>
                  <p className="text-sm font-bold text-indigo-900 leading-relaxed">{latestScore.recommended_strategy}</p>
                </div>
                
                {latestScore.factors && (
                  <div>
                    <p className="text-xs text-slate-400 font-bold mb-2">العوامل المؤثرة</p>
                    <div className="space-y-2">
                      {latestScore.factors.slice(0, 4).map((f: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-white p-2 rounded-lg border border-slate-100 shadow-sm">
                          <span className="text-slate-600 font-bold">{f.name}</span>
                          <span className={`font-bold px-2 py-0.5 rounded ${f.impact === 'positive' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                            {f.impact === 'positive' ? '+' : '−'}{f.weight}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-slate-400 text-center font-bold">آخر تقييم: {formatDate(latestScore.created_at)}</p>
              </div>
            ) : (
              <p className="text-slate-500 text-sm font-bold text-center py-6">لا يوجد تقييم حالياً. اضغط "تقييم المديونية" لبدء التحليل.</p>
            )}
          </div>

          {/* Customer 360: AI Actions */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
              <BrainCircuit className="text-blue-500" size={18} />
              <h2 className="text-base font-bold text-[#1e3e50]">إجراءات AI الأخيرة</h2>
            </div>
            {aiActions?.length ? (
              <div className="space-y-3">
                {aiActions.map((a: any) => (
                  <div key={a.id} className="border border-slate-100 bg-slate-50/50 rounded-xl p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-bold text-[#1e3e50]">{a.action_type}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${a.priority === 'high' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>{a.priority}</span>
                    </div>
                    <p className="text-xs text-slate-500 mb-2 leading-relaxed">{a.reason}</p>
                    {a.suggested_message && <p className="text-xs bg-white border border-slate-200 text-slate-700 p-2 rounded-lg leading-relaxed shadow-sm">"{a.suggested_message}"</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-xs font-bold text-center py-4">لا توجد إجراءات مسجلة.</p>
            )}
          </div>

          {/* Customer 360: Promises */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
              <Calendar className="text-amber-500" size={18} />
              <h2 className="text-base font-bold text-[#1e3e50]">وعود السداد</h2>
            </div>
            {promises?.length ? (
              <div className="space-y-3">
                {promises.map((pr: any) => (
                  <div key={pr.id} className="border border-slate-100 bg-slate-50/50 rounded-xl p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-bold text-emerald-600">{formatCurrency(pr.promised_amount, debt.currency)}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${pr.status === 'kept' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : pr.status === 'broken' ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-yellow-50 text-yellow-600 border-yellow-200'}`}>{pr.status}</span>
                    </div>
                    <p className="text-xs text-slate-500 font-bold flex justify-between">
                      <span>{formatDate(pr.promised_date)}</span>
                      <span className="bg-white px-2 py-0.5 border border-slate-200 rounded text-slate-400">{pr.channel}</span>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-xs font-bold text-center py-4">لا توجد وعود مسجلة.</p>
            )}
          </div>

          {/* Customer 360: Approvals */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
              <ShieldAlert className="text-rose-500" size={18} />
              <h2 className="text-base font-bold text-[#1e3e50]">الموافقات</h2>
            </div>
            {approvals?.length ? (
              <div className="space-y-3">
                {approvals.map((ap: any) => (
                  <div key={ap.id} className="border border-slate-100 bg-slate-50/50 rounded-xl p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-bold text-[#1e3e50]">{ap.approval_type}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${ap.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : ap.status === 'rejected' ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>{ap.status}</span>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed mb-1">{ap.reason}</p>
                    <p className="text-[10px] text-slate-400 font-bold">{formatDate(ap.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-400 text-xs font-bold text-center py-4">لا توجد موافقات مسجلة.</p>
            )}
          </div>

          {/* Active Alerts */}
          {debtAlerts?.length > 0 && (
            <div className="bg-rose-50/50 rounded-2xl p-6 shadow-sm border border-rose-100">
              <div className="flex items-center gap-2 border-b border-rose-200/50 pb-3 mb-4">
                <BellRing className="text-rose-600" size={18} />
                <h2 className="text-base font-bold text-rose-900">تنبيهات نشطة</h2>
              </div>
              <div className="space-y-3">
                {debtAlerts.map((al: any) => (
                  <div key={al.id} className="bg-white border border-rose-200 rounded-xl p-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-bold text-rose-700">{al.title}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-rose-100 text-rose-600">{al.severity}</span>
                    </div>
                    {al.message && <p className="text-xs text-rose-600/80 leading-relaxed">{al.message}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
