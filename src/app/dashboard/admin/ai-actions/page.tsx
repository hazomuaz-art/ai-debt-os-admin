import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, getStatusColor } from '@/lib/utils'
import { GenerateActionsButton } from '@/components/ai/GenerateActionsButton'
import { CompleteActionButton } from '@/components/ai/CompleteActionButton'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'
import { BrainCircuit, CheckCircle2, Clock, MessageSquare, PhoneCall, Mail, UserCheck, AlertTriangle } from 'lucide-react'

export default async function AIActionsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) redirect('/login')

  const today = new Date().toISOString().split('T')[0]

  const { data: actions } = await supabase
    .from('ai_actions')
    .select(`
      *,
      debt:debts(id, reference_number, current_balance, currency),
      customer:customers(id, full_name, phone, whatsapp)
    `)
    .eq('company_id', profile.company_id)
    .eq('scheduled_for', today)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })

  const priorityCounts = (actions ?? []).reduce((acc: Record<string, number>, a) => {
    acc[a.priority] = (acc[a.priority] ?? 0) + 1
    return acc
  }, {})

  const completedCount = (actions ?? []).filter(a => a.status === 'completed').length

  const PRIORITY_ARABIC: Record<string, string> = {
    critical: 'حرج جداً',
    high: 'عالي',
    medium: 'متوسط',
    low: 'منخفض'
  }

  const PRIORITY_STYLES: Record<string, string> = {
    critical: 'bg-rose-50 text-rose-600 border-rose-200',
    high: 'bg-orange-50 text-orange-600 border-orange-200',
    medium: 'bg-amber-50 text-amber-600 border-amber-200',
    low: 'bg-slate-50 text-slate-500 border-slate-200',
  }

  const getIconForAction = (type: string) => {
    switch (type) {
      case 'call': return <PhoneCall size={20} className="text-purple-500" />
      case 'whatsapp': return <MessageSquare size={20} className="text-emerald-500" />
      case 'email': return <Mail size={20} className="text-blue-500" />
      case 'visit': return <UserCheck size={20} className="text-amber-500" />
      case 'legal': return <AlertTriangle size={20} className="text-rose-500" />
      default: return <BrainCircuit size={20} className="text-slate-400" />
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#e6f0f9] text-[#1e3e50] rounded-xl flex items-center justify-center shrink-0">
            <BrainCircuit size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">خطة عمل الذكاء الاصطناعي (AI Action Plan)</h1>
            <p className="text-slate-500 text-sm">
              إجراءات وتوصيات اليوم ({new Date().toLocaleDateString('ar-SA')}) — تم إنجاز {completedCount} من أصل {(actions ?? []).length}
            </p>
          </div>
        </div>
        <GenerateActionsButton />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(['critical', 'high', 'medium', 'low'] as const).map(priority => (
          <div key={priority} className={`bg-white rounded-2xl border p-5 flex flex-col justify-between hover:shadow-md transition-shadow ${PRIORITY_STYLES[priority].replace('bg-', 'border-').split(' ')[2] || 'border-slate-100'}`}>
            <div className="text-slate-500 text-sm font-bold mb-2">أولوية: {PRIORITY_ARABIC[priority]}</div>
            <div className={`text-3xl font-bold font-mono ${PRIORITY_STYLES[priority].split(' ')[1]}`}>
              {priorityCounts[priority] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* Actions list */}
      <div className="space-y-4">
        {(actions ?? []).length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center shadow-sm">
            <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
              <BrainCircuit size={40} />
            </div>
            <div className="font-bold text-xl text-[#1e3e50] mb-2">لا توجد إجراءات مجدولة لليوم</div>
            <p className="text-slate-500 text-sm mb-6">اضغط على زر (توليد الخطة) ليقوم الذكاء الاصطناعي بتحليل المحفظة واقتراح المهام.</p>
            <GenerateActionsButton />
          </div>
        ) : (actions ?? []).map((action: {
          id: string
          action_type: string
          priority: string
          reason: string
          suggested_message?: string
          best_time_to_contact?: string
          status: string
          customer?: { full_name?: string; phone?: string; whatsapp?: string } | null
          debt?: { reference_number?: string; current_balance?: number; currency?: string } | null
        }) => (
          <div key={action.id} className={`bg-white rounded-2xl border border-slate-100 shadow-sm p-6 transition-all duration-200 hover:shadow-md ${action.status === 'completed' ? 'opacity-60 bg-slate-50/50' : ''}`}>
            <div className="flex flex-col md:flex-row items-start justify-between gap-6">
              
              <div className="flex items-start gap-4 flex-1 w-full">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  action.action_type === 'whatsapp' ? 'bg-emerald-50' :
                  action.action_type === 'call' ? 'bg-purple-50' :
                  action.action_type === 'email' ? 'bg-blue-50' : 'bg-slate-50'
                }`}>
                  {getIconForAction(action.action_type)}
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <span className="font-bold text-[#1e3e50] text-lg">{(action.customer as {full_name?: string} | null)?.full_name ?? 'عميل غير معروف'}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${PRIORITY_STYLES[action.priority] ?? PRIORITY_STYLES.low}`}>
                      أولوية {PRIORITY_ARABIC[action.priority] ?? action.priority}
                    </span>
                    <span className="bg-[#f0f4f8] text-slate-500 text-xs font-bold px-2 py-1 rounded-md font-mono">
                      ملف: {(action.debt as {reference_number?: string} | null)?.reference_number}
                    </span>
                  </div>
                  
                  <div className="text-slate-600 text-sm font-medium leading-relaxed mb-3">السبب: {action.reason}</div>
                  
                  {action.suggested_message && (
                    <div className="p-4 bg-[#fcfdfd] rounded-xl border border-slate-100 mb-3 relative">
                      <div className="absolute top-0 right-4 -translate-y-1/2 bg-white px-2 text-xs font-bold text-blue-500 border border-slate-100 rounded-md">الرسالة المقترحة</div>
                      <div className="text-slate-600 text-sm font-medium leading-relaxed whitespace-pre-wrap">{action.suggested_message}</div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-4 text-xs font-bold text-slate-400 mt-4">
                    {action.best_time_to_contact && (
                      <span className="flex items-center gap-1.5"><Clock size={14}/> {action.best_time_to_contact}</span>
                    )}
                    {(action.debt as {current_balance?: number; currency?: string} | null)?.current_balance && (
                      <span className="flex items-center gap-1.5 font-mono">
                        المبلغ: {formatCurrency((action.debt as {current_balance: number; currency: string}).current_balance, (action.debt as {currency: string}).currency)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-row md:flex-col gap-2 w-full md:w-auto mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 border-slate-100">
                {action.status !== 'completed' ? (
                  <>
                    {(action.action_type === 'whatsapp') && (action.customer as {whatsapp?: string} | null)?.whatsapp && (
                      <SendWhatsAppButton
                        actionId={action.id}
                        customerId={(action.customer as {id?: string} | null)?.id ?? ''}
                        phone={(action.customer as {whatsapp?: string}).whatsapp ?? ''}
                        message={action.suggested_message ?? ''}
                        debtId={(action.debt as {id?: string} | null)?.id ?? ''}
                      />
                    )}
                    <CompleteActionButton actionId={action.id} />
                  </>
                ) : (
                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 font-bold rounded-xl border border-emerald-100 text-sm">
                    <CheckCircle2 size={18} /> تم التنفيذ بنجاح
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
