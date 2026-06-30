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
import PrintConversationButton from '@/components/debt/PrintConversationButton'
import EditWhatsAppButton from '@/components/debt/EditWhatsAppButton'

export default async function DebtDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  // Defense-in-depth: the debts RLS policy already enforces
  // company_id = get_user_company_id() at the database level (verified
  // directly against the real policy during a full-system audit), so this
  // was never actually exploitable — but every other data-access point in
  // this app scopes by company_id explicitly too, and this page was the
  // one place that didn't. Hardens against a future RLS policy regression.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()
  const { data: profile } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
  if (!profile?.company_id) notFound()

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
    .eq('company_id', profile.company_id)
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

  let outcomeCategories: string[] | null = null
  if (debt.portfolio_id) {
    const { data: portfolioRow } = await supabase
      .from('portfolios').select('metadata').eq('id', debt.portfolio_id).maybeSingle()
    const meta = (portfolioRow?.metadata as Record<string, unknown> | null) ?? {}
    if (Array.isArray(meta.outcome_categories) && meta.outcome_categories.length > 0) {
      outcomeCategories = meta.outcome_categories as string[]
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">

      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/collector/debts" className="w-10 h-10 rounded-full bg-[#222a36] flex items-center justify-center text-[#8b95a7] hover:bg-[#222a36] hover:text-white transition-colors">
            <ArrowRight size={20} />
          </Link>
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <User size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">{debt.customer?.full_name}</h1>
            <p className="text-[#8b95a7] text-sm font-mono" dir="ltr">{debt.reference_number}</p>
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
          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-5">
              <CreditCard className="text-white" size={20} />
              <h2 className="text-lg font-bold text-white">نظرة عامة على المديونية</h2>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="bg-[#222a36] p-4 rounded-xl border border-[#222a36]">
                <p className="text-[#8b95a7] text-xs font-bold mb-1">المبلغ الأساسي</p>
                <p className="text-xl font-bold text-white">{formatCurrency(debt.original_amount, debt.currency)}</p>
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
                <p className="text-[#8b95a7] text-sm font-bold mb-2">حالة المديونية</p>
                <UpdateDebtStatusSelect debtId={debt.id} currentStatus={debt.status} />
              </div>
              <div>
                <p className="text-[#8b95a7] text-sm font-bold mb-2">الأولوية</p>
                <span className={`inline-flex px-3 py-1.5 rounded-lg text-sm font-bold border ${
                  debt.priority === 'critical' ? 'bg-rose-50 text-rose-600 border-rose-200' :
                  debt.priority === 'high' ? 'bg-orange-50 text-orange-600 border-orange-200' :
                  debt.priority === 'medium' ? 'bg-yellow-50 text-yellow-600 border-yellow-200' :
                  'bg-[#222a36] text-slate-300 border-[#222a36]'
                }`}>
                  {debt.priority === 'critical' ? 'حرج جداً' :
                   debt.priority === 'high' ? 'مرتفع' :
                   debt.priority === 'medium' ? 'متوسط' : 'منخفض'}
                </span>
              </div>
            </div>
            {debt.description && (
              <div className="mt-6 pt-6 border-t border-[#222a36]">
                <p className="text-[#8b95a7] text-sm font-bold mb-2">الوصف وملاحظات الدين</p>
                <p className="text-slate-200 leading-relaxed bg-[#0d1117] p-4 rounded-xl border border-[#222a36]">{debt.description}</p>
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
          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <div className="flex items-center justify-between border-b border-[#222a36] pb-4 mb-5">
              <div className="flex items-center gap-2">
                <Wallet className="text-emerald-600" size={20} />
                <h2 className="text-lg font-bold text-white">سجل المدفوعات</h2>
              </div>
              <RecordPaymentModal
                debtId={debt.id}
                currentBalance={debt.current_balance}
                currency={debt.currency}
              />
            </div>
            {debt.payments?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="text-[#8b95a7] bg-[#222a36]">
                      <th className="p-3 rounded-r-xl font-bold">التاريخ</th>
                      <th className="p-3 font-bold">المبلغ</th>
                      <th className="p-3 font-bold">طريقة الدفع</th>
                      <th className="p-3 font-bold">المرجع</th>
                      <th className="p-3 rounded-l-xl font-bold">ملاحظات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1c2330]">
                    {debt.payments.map((p: any) => (
                      <tr key={p.id} className="hover:bg-[#1a212c] transition-colors">
                        <td className="p-3 text-slate-300">{formatDate(p.payment_date)}</td>
                        <td className="p-3 font-bold text-emerald-600">{formatCurrency(p.amount, debt.currency)}</td>
                        <td className="p-3 text-slate-300">{p.payment_method || '—'}</td>
                        <td className="p-3 text-[#8b95a7] font-mono text-xs">{p.reference_number || '—'}</td>
                        <td className="p-3 text-[#8b95a7]">{p.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-[#5f6b7e] font-bold bg-[#222a36]/50 rounded-xl border border-[#222a36] border-dashed">
                لم يتم تسجيل أي مدفوعات حتى الآن
              </div>
            )}
          </div>

          {/* Message History */}
          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <div className="flex items-center justify-between gap-2 border-b border-[#222a36] pb-4 mb-5">
              <div className="flex items-center gap-2">
                <MessageSquare className="text-blue-500" size={20} />
                <h2 className="text-lg font-bold text-white">سجل المراسلات</h2>
              </div>
              <PrintConversationButton
                customerName={debt.customer?.full_name}
                debtReference={debt.reference_number}
                creditorName={debt.creditor_name}
                messages={debt.messages ?? []}
              />
            </div>
            {debt.messages?.length > 0 ? (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pe-2 custom-scrollbar">
                {debt.messages.map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-xs lg:max-w-md px-5 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      msg.direction === 'outbound'
                        ? 'bg-[#0e7a54] text-white rounded-tr-none'
                        : 'bg-[#151a23] border border-[#222a36] text-slate-100 rounded-tl-none'
                    }`}>
                      <p>{msg.content}</p>
                      <p className={`text-[10px] mt-2 font-bold ${msg.direction === 'outbound' ? 'text-[#5f6b7e]' : 'text-[#5f6b7e]'}`}>
                        {formatDate(msg.sent_at || msg.created_at)} • {msg.channel}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-[#5f6b7e] font-bold bg-[#222a36]/50 rounded-xl border border-[#222a36] border-dashed">
                لا توجد رسائل مسجلة
              </div>
            )}
          </div>
          
          {/* Timeline Events */}
          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-5">
              <History className="text-purple-500" size={20} />
              <h2 className="text-lg font-bold text-white">الخط الزمني المباشر (Timeline)</h2>
            </div>
            {timelineEvents?.length ? (
              <div className="space-y-6 relative before:absolute before:inset-0 before:ms-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                {timelineEvents.map((ev: any) => (
                  <div key={ev.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-white bg-[#222a36] text-[#8b95a7] shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                      <Activity size={16} />
                    </div>
                    <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded-xl border border-[#222a36] bg-[#151a23] shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-white text-sm">{ev.summary}</span>
                        <span className="text-[10px] bg-[#222a36] text-[#8b95a7] px-2 py-0.5 rounded-md border border-[#222a36]">{ev.channel || 'نظام'}</span>
                      </div>
                      <p className="text-xs text-[#5f6b7e] mt-2 font-mono" dir="ltr">{new Date(ev.occurred_at).toLocaleString('ar-SA')}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#5f6b7e] text-center py-8 font-bold bg-[#222a36]/50 rounded-xl border border-[#222a36] border-dashed">لا توجد أحداث مسجلة</p>
            )}
          </div>
        </div>

        {/* Sidebar (Left Column in RTL) */}
        <div className="space-y-6">
          
          {/* Customer Info */}
          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-4">
              <User className="text-white" size={20} />
              <h2 className="text-lg font-bold text-white">بيانات العميل</h2>
            </div>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-[#8b95a7] font-bold">الاسم</span>
                <span className="font-bold text-white">{debt.customer?.full_name}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-[#8b95a7] font-bold">الهاتف</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold font-mono text-white" dir="ltr">{debt.customer?.phone || '—'}</span>
                  {debt.customer?.phone && <SendWhatsAppButton debtId={debt.id} phone={debt.customer.phone} customerName={debt.customer.full_name} small />}
                </div>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-[#8b95a7] font-bold">واتساب</span>
                <div className="flex items-center gap-2">
                  <span className="font-bold font-mono text-white" dir="ltr">{debt.customer?.whatsapp || '—'}</span>
                  {debt.customer?.whatsapp && <SendWhatsAppButton debtId={debt.id} phone={debt.customer.whatsapp} customerName={debt.customer.full_name} small />}
                  {debt.customer?.id && <EditWhatsAppButton customerId={debt.customer.id} currentWhatsapp={debt.customer.whatsapp} />}
                </div>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-[#8b95a7] font-bold">رقم الحساب / العقد</span>
                <span className="font-bold font-mono text-white">{debt.account_number || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-[#8b95a7] font-bold">نوع المنتج</span>
                <span className="font-bold text-white">{debt.product_type || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-[#8b95a7] font-bold">الهوية الوطنية</span>
                <span className="font-bold font-mono text-white">{debt.customer?.national_id || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-[#8b95a7] font-bold">المدينة</span>
                <span className="font-bold text-white">{debt.customer?.city || '—'}</span>
              </div>
              <div className="flex justify-between items-center pb-3 border-b border-slate-50">
                <span className="text-[#8b95a7] font-bold">جهة العمل</span>
                <span className="font-bold text-white">{debt.customer?.employer || '—'}</span>
              </div>
              {debt.customer?.monthly_income && (
                <div className="flex justify-between items-center">
                  <span className="text-[#8b95a7] font-bold">الدخل الشهري</span>
                  <span className="font-bold text-emerald-600">{formatCurrency(debt.customer.monthly_income, debt.currency)}</span>
                </div>
              )}
            </div>
          </div>

          {outcomeCategories && outcomeCategories.length > 0 && (
            <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
              <div className="flex items-center gap-2 border-b border-[#222a36] pb-4 mb-4">
                <Target className="text-amber-400" size={20} />
                <h2 className="text-lg font-bold text-white">تصنيفات النتائج</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {outcomeCategories.map((cat: string) => (
                  <span key={cat} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#222a36] text-slate-300 border border-[#2c3543]">
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <h2 className="text-sm font-bold text-[#8b95a7] mb-3">المحصّل المسؤول</h2>
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
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center border-4 shadow-sm bg-[#151a23] ${
                    latestScore.score >= 70 ? 'border-emerald-400 text-emerald-600' :
                    latestScore.score >= 40 ? 'border-amber-400 text-amber-600' : 'border-rose-400 text-rose-600'
                  }`}>
                    <span className="text-4xl font-bold font-mono">{latestScore.score}</span>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white mb-1">{latestScore.risk_classification}</p>
                    <p className="text-xs text-[#8b95a7] flex items-center gap-1">
                      <Target size={12} className="text-indigo-400" />
                      احتمالية التحصيل: <strong className="text-white">{Math.round(latestScore.collection_probability * 100)}%</strong>
                    </p>
                  </div>
                </div>
                
                <div className="bg-[#151a23] rounded-xl p-4 border border-indigo-50 shadow-sm">
                  <p className="text-xs text-indigo-400 font-bold mb-1">الاستراتيجية المقترحة</p>
                  <p className="text-sm font-bold text-indigo-900 leading-relaxed">{latestScore.recommended_strategy}</p>
                </div>
                
                {latestScore.factors && (
                  <div>
                    <p className="text-xs text-[#5f6b7e] font-bold mb-2">العوامل المؤثرة</p>
                    <div className="space-y-2">
                      {latestScore.factors.slice(0, 4).map((f: any, i: number) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-[#151a23] p-2 rounded-lg border border-[#222a36] shadow-sm">
                          <span className="text-slate-300 font-bold">{f.name}</span>
                          <span className={`font-bold px-2 py-0.5 rounded ${f.impact === 'positive' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                            {f.impact === 'positive' ? '+' : '−'}{f.weight}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <p className="text-[10px] text-[#5f6b7e] text-center font-bold">آخر تقييم: {formatDate(latestScore.created_at)}</p>
              </div>
            ) : (
              <p className="text-[#8b95a7] text-sm font-bold text-center py-6">لا يوجد تقييم حالياً. اضغط "تقييم المديونية" لبدء التحليل.</p>
            )}
          </div>

          {/* Customer 360: AI Actions */}
          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-3 mb-4">
              <BrainCircuit className="text-blue-500" size={18} />
              <h2 className="text-base font-bold text-white">إجراءات AI الأخيرة</h2>
            </div>
            {aiActions?.length ? (
              <div className="space-y-3">
                {aiActions.map((a: any) => (
                  <div key={a.id} className="border border-[#222a36] bg-[#222a36]/50 rounded-xl p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-sm font-bold text-white">{a.action_type}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${a.priority === 'high' ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-[#222a36] text-[#8b95a7] border-[#222a36]'}`}>{a.priority}</span>
                    </div>
                    <p className="text-xs text-[#8b95a7] mb-2 leading-relaxed">{a.reason}</p>
                    {a.suggested_message && <p className="text-xs bg-[#151a23] border border-[#222a36] text-slate-200 p-2 rounded-lg leading-relaxed shadow-sm">"{a.suggested_message}"</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#5f6b7e] text-xs font-bold text-center py-4">لا توجد إجراءات مسجلة.</p>
            )}
          </div>

          {/* Customer 360: Promises */}
          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-3 mb-4">
              <Calendar className="text-amber-500" size={18} />
              <h2 className="text-base font-bold text-white">وعود السداد</h2>
            </div>
            {promises?.length ? (
              <div className="space-y-3">
                {promises.map((pr: any) => (
                  <div key={pr.id} className="border border-[#222a36] bg-[#222a36]/50 rounded-xl p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-bold text-emerald-600">{formatCurrency(pr.promised_amount, debt.currency)}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${pr.status === 'kept' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : pr.status === 'broken' ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-yellow-50 text-yellow-600 border-yellow-200'}`}>{pr.status}</span>
                    </div>
                    <p className="text-xs text-[#8b95a7] font-bold flex justify-between">
                      <span>{formatDate(pr.promised_date)}</span>
                      <span className="bg-[#151a23] px-2 py-0.5 border border-[#222a36] rounded text-[#5f6b7e]">{pr.channel}</span>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#5f6b7e] text-xs font-bold text-center py-4">لا توجد وعود مسجلة.</p>
            )}
          </div>

          {/* Customer 360: Approvals */}
          <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36]">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-3 mb-4">
              <ShieldAlert className="text-rose-500" size={18} />
              <h2 className="text-base font-bold text-white">الموافقات</h2>
            </div>
            {approvals?.length ? (
              <div className="space-y-3">
                {approvals.map((ap: any) => (
                  <div key={ap.id} className="border border-[#222a36] bg-[#222a36]/50 rounded-xl p-3 hover:shadow-sm transition-shadow">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-bold text-white">{ap.approval_type}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${ap.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : ap.status === 'rejected' ? 'bg-rose-50 text-rose-600 border-rose-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>{ap.status}</span>
                    </div>
                    <p className="text-xs text-[#8b95a7] leading-relaxed mb-1">{ap.reason}</p>
                    <p className="text-[10px] text-[#5f6b7e] font-bold">{formatDate(ap.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#5f6b7e] text-xs font-bold text-center py-4">لا توجد موافقات مسجلة.</p>
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
                  <div key={al.id} className="bg-[#151a23] border border-rose-200 rounded-xl p-3 shadow-sm">
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
