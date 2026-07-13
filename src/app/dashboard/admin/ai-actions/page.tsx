import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, getStatusColor } from '@/lib/utils'
import { GenerateActionsButton } from '@/components/ai/GenerateActionsButton'
import { CompleteActionButton } from '@/components/ai/CompleteActionButton'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'
import { BrainCircuit, CheckCircle2, Clock, MessageSquare, PhoneCall, Mail, UserCheck, AlertTriangle } from 'lucide-react'
import { getServerTranslation } from '@/lib/i18n/server'

export default async function AIActionsPage() {
  const supabase = await createClient()
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

  const { t, dir, locale } = await getServerTranslation()
  const a = t.pages.ai_actions

  const PRIORITY_LABEL: Record<string, string> = {
    critical: a.p_critical, high: a.p_high, medium: a.p_medium, low: a.p_low,
  }

  const PRIORITY_STYLES: Record<string, string> = {
    critical: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    high: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    low: 'bg-[#222a36] text-[#8b95a7] border-[#2c3543]',
  }

  const getIconForAction = (type: string) => {
    switch (type) {
      case 'call': return <PhoneCall size={20} className="text-purple-400" />
      case 'whatsapp': return <MessageSquare size={20} className="text-emerald-400" />
      case 'email': return <Mail size={20} className="text-blue-400" />
      case 'visit': return <UserCheck size={20} className="text-amber-400" />
      case 'legal': return <AlertTriangle size={20} className="text-rose-400" />
      default: return <BrainCircuit size={20} className="text-[#5f6b7e]" />
    }
  }

  return (
    <div dir={dir} className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >

      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0">
            <BrainCircuit size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">{a.title}</h1>
            <p className="text-[#8b95a7] text-sm">
              {a.subtitle
                .replace('{date}', new Date().toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-GB'))
                .replace('{done}', String(completedCount))
                .replace('{total}', String((actions ?? []).length))}
            </p>
          </div>
        </div>
        <GenerateActionsButton />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(['critical', 'high', 'medium', 'low'] as const).map(priority => (
          <div key={priority} className="bg-[#151a23] rounded-2xl border border-[#222a36] p-5 flex flex-col justify-between">
            <div className="text-[#8b95a7] text-sm font-bold mb-2">{a.priority}: {PRIORITY_LABEL[priority]}</div>
            <div className={`text-3xl font-bold font-mono ${PRIORITY_STYLES[priority].split(' ')[1]}`}>
              {priorityCounts[priority] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* Actions list */}
      <div className="space-y-4">
        {(actions ?? []).length === 0 ? (
          <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-16 text-center shadow-sm">
            <div className="w-20 h-20 bg-[#222a36] text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
              <BrainCircuit size={40} />
            </div>
            <div className="font-bold text-xl text-white mb-2">{a.none_title}</div>
            <p className="text-[#8b95a7] text-sm mb-6">{a.none_sub}</p>
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
          <div key={action.id} className={`bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 transition-all duration-200 hover:shadow-md ${action.status === 'completed' ? 'opacity-60 bg-[#222a36]/50' : ''}`}>
            <div className="flex flex-col md:flex-row items-start justify-between gap-6">
              
              <div className="flex items-start gap-4 flex-1 w-full">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                  action.action_type === 'whatsapp' ? 'bg-emerald-500/10' :
                  action.action_type === 'call' ? 'bg-purple-500/10' :
                  action.action_type === 'email' ? 'bg-blue-500/10' : 'bg-[#222a36]'
                }`}>
                  {getIconForAction(action.action_type)}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <span className="font-bold text-white text-lg">{(action.customer as {full_name?: string} | null)?.full_name ?? t.ui.unknown_customer}</span>
                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${PRIORITY_STYLES[action.priority] ?? PRIORITY_STYLES.low}`}>
                      {a.priority} {PRIORITY_LABEL[action.priority] ?? action.priority}
                    </span>
                    <span className="bg-[#0b0e14] text-[#8b95a7] text-xs font-bold px-2 py-1 rounded-md font-mono">
                      {a.file_label} {(action.debt as {reference_number?: string} | null)?.reference_number}
                    </span>
                  </div>

                  <div className="text-slate-300 text-sm font-medium leading-relaxed mb-3">{a.reason_label} {action.reason}</div>

                  {action.suggested_message && (
                    <div className="p-4 bg-[#0d1117] rounded-xl border border-[#222a36] mb-3 relative">
                      <div className="absolute top-0 end-4 -translate-y-1/2 bg-[#151a23] px-2 text-xs font-bold text-blue-400 border border-[#222a36] rounded-md">{a.suggested_message}</div>
                      <div className="text-slate-300 text-sm font-medium leading-relaxed whitespace-pre-wrap">{action.suggested_message}</div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-4 text-xs font-bold text-[#5f6b7e] mt-4">
                    {action.best_time_to_contact && (
                      <span className="flex items-center gap-1.5"><Clock size={14}/> {action.best_time_to_contact}</span>
                    )}
                    {(action.debt as {current_balance?: number; currency?: string} | null)?.current_balance && (
                      <span className="flex items-center gap-1.5 font-mono">
                        {a.amount_label} {formatCurrency((action.debt as {current_balance: number; currency: string}).current_balance, (action.debt as {currency: string}).currency)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-row md:flex-col gap-2 w-full md:w-auto mt-4 md:mt-0 pt-4 md:pt-0 border-t md:border-t-0 border-[#222a36]">
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
                  <div className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 text-emerald-400 font-bold rounded-xl border border-emerald-500/20 text-sm">
                    <CheckCircle2 size={18} /> {a.done_success}
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
