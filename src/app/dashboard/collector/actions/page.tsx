import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import { CompleteActionButton } from '@/components/ai/CompleteActionButton'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'
import { CheckCircle2, Clock, MapPin, Phone, ShieldAlert, Mail, Handshake, AlertTriangle, MessageCircle, MoreHorizontal } from 'lucide-react'

export default async function CollectorActionsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().split('T')[0]

  const { data: actions } = await supabase
    .from('ai_actions')
    .select(`
      *,
      debt:debts(id, reference_number, current_balance, currency),
      customer:customers(id, full_name, phone, whatsapp)
    `)
    .eq('assigned_to', user.id)
    .eq('scheduled_for', today)
    .order('priority', { ascending: false })

  const pending = (actions ?? []).filter(a => a.status === 'pending').length
  const done = (actions ?? []).filter(a => a.status === 'completed').length

  const actionTypeIcons: Record<string, React.ReactNode> = {
    call: <Phone size={20} />,
    whatsapp: <MessageCircle size={20} />,
    email: <Mail size={20} />,
    visit: <MapPin size={20} />,
    legal: <ShieldAlert size={20} />,
    escalate: <AlertTriangle size={20} />,
    settle: <Handshake size={20} />,
  }

  const actionTypeLabels: Record<string, string> = {
    call: 'مكالمة هاتفية',
    whatsapp: 'رسالة واتساب',
    email: 'بريد إلكتروني',
    visit: 'زيارة ميدانية',
    legal: 'إجراء قانوني',
    escalate: 'تصعيد الإجراء',
    settle: 'تسوية',
  }

  const getPriorityStyle = (p: string) => {
    if (p === 'critical' || p === 'high') return 'bg-rose-50 text-rose-600 border-rose-200'
    if (p === 'medium') return 'bg-amber-50 text-amber-600 border-amber-200'
    return 'bg-blue-50 text-blue-600 border-blue-200'
  }

  const getPriorityLabel = (p: string) => {
    const labels: Record<string, string> = {
      critical: 'حرج جداً', high: 'مرتفع', medium: 'متوسط', low: 'منخفض'
    }
    return labels[p] ?? p
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center shrink-0">
            <Clock size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">إجراءات اليوم</h1>
            <p className="text-slate-500 text-sm font-medium">المهام الواجب تنفيذها لليوم: {done} مكتملة، و {pending} قيد الانتظار</p>
          </div>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex items-center justify-between shadow-sm">
          <div>
            <div className="text-emerald-600 font-bold text-sm mb-1">المهام المنجزة</div>
            <div className="text-3xl font-mono font-bold text-emerald-700">{done}</div>
          </div>
          <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
            <CheckCircle2 size={24} />
          </div>
        </div>
        <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex items-center justify-between shadow-sm">
          <div>
            <div className="text-amber-600 font-bold text-sm mb-1">قيد الانتظار</div>
            <div className="text-3xl font-mono font-bold text-amber-700">{pending}</div>
          </div>
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
            <Clock size={24} />
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {(actions ?? []).length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
            <div className="w-20 h-20 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={40} />
            </div>
            <div className="font-bold text-xl text-[#1e3e50] mb-2">لا توجد أي مهام مجدولة لليوم</div>
            <p className="text-slate-500 text-sm">عمل رائع! لقد أنهيت جميع المهام المسندة إليك.</p>
          </div>
        ) : (actions ?? []).map(action => (
          <div key={action.id} className={`bg-white rounded-2xl border shadow-sm transition-all duration-300 p-6 ${action.status === 'completed' ? 'opacity-60 bg-slate-50/50 border-slate-100' : 'border-slate-100 hover:shadow-md'}`}>
            <div className="flex flex-col md:flex-row items-start justify-between gap-6">
              
              <div className="flex items-start gap-4 flex-1">
                <div className={`mt-1 w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                  action.action_type === 'whatsapp' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                  action.action_type === 'call' ? 'bg-blue-50 text-blue-600 border border-blue-100' :
                  'bg-slate-100 text-slate-500 border border-slate-200'
                }`}>
                  {actionTypeIcons[action.action_type] ?? <MoreHorizontal size={24} />}
                </div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <span className="font-bold text-[#1e3e50] text-lg">{(action.customer as {full_name?: string} | null)?.full_name}</span>
                    <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${getPriorityStyle(action.priority)}`}>
                      {getPriorityLabel(action.priority)}
                    </span>
                    <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-2 py-1 rounded-md">
                      {actionTypeLabels[action.action_type] ?? action.action_type}
                    </span>
                  </div>
                  
                  <div className="text-slate-500 text-sm font-medium mb-3 bg-[#fcfdfd] border border-slate-100 p-3 rounded-xl leading-relaxed">
                    {action.reason}
                  </div>
                  
                  {action.suggested_message && (
                    <div className="mt-3 p-4 bg-blue-50/50 rounded-xl border border-blue-100 text-[#1e3e50] text-sm relative">
                      <span className="absolute -top-2.5 right-4 bg-white px-2 text-[10px] font-bold text-blue-500 border border-blue-100 rounded-md">رسالة مقترحة</span>
                      {action.suggested_message}
                    </div>
                  )}
                  
                  <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-bold text-slate-500">
                    {action.best_time_to_contact && (
                      <span className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                        <Clock size={14} className="text-slate-400" /> {action.best_time_to_contact}
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                      رصيد المديونية: 
                      <span className="text-emerald-600 font-mono text-sm ml-1">
                        {formatCurrency((action.debt as {current_balance: number; currency: string} | null)?.current_balance ?? 0, (action.debt as {currency: string} | null)?.currency ?? 'SAR')}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-row md:flex-col gap-3 shrink-0 w-full md:w-auto pt-4 md:pt-0 border-t border-slate-100 md:border-0 justify-end">
                {action.status !== 'completed' && (
                  <>
                    {action.action_type === 'whatsapp' && (action.customer as {whatsapp?: string} | null)?.whatsapp && (
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
                )}
                {action.status === 'completed' && (
                  <span className="flex items-center justify-center gap-1.5 text-emerald-500 text-sm font-bold bg-emerald-50 px-6 py-3 rounded-xl border border-emerald-100">
                    <CheckCircle2 size={18} /> منجزة
                  </span>
                )}
              </div>

            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
