import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import GenerateActionsButton from '@/components/ai/GenerateActionsButton'
import { Zap, Clock, CheckCircle, Bot, MessageCircle, Phone, Mail } from 'lucide-react'

export default async function ManagerAIActionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || !['admin', 'manager'].includes(profile.role)) redirect('/dashboard/collector')

  const today = new Date().toISOString().split('T')[0]

  const { data: actions } = await supabase
    .from('ai_actions')
    .select(`
      *,
      debt:debts(reference_number, customer:customers(full_name, phone)),
      assigned_to_profile:profiles!ai_actions_assigned_to_fkey(full_name)
    `)
    .eq('company_id', profile.company_id)
    .eq('scheduled_for', today)
    .order('priority_score', { ascending: false })

  const pending = actions?.filter(a => a.status === 'pending').length ?? 0
  const completed = actions?.filter(a => a.status === 'completed').length ?? 0

  const actionTypeIcons: Record<string, any> = {
    call: Phone,
    whatsapp: MessageCircle,
    email: Mail,
  }

  const getStatusLabel = (s: string) => {
    return s === 'completed' ? 'منجز' : s === 'pending' ? 'قيد الانتظار' : s
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center shrink-0">
            <Bot size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">إجراءات الذكاء الاصطناعي</h1>
            <p className="text-[#8b95a7] text-sm">مراقبة المهام والتوصيات التلقائية الصادرة اليوم لفريقك.</p>
          </div>
        </div>
        <GenerateActionsButton />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-amber-50 text-amber-500 shadow-sm shrink-0">
            <Clock size={22} />
          </div>
          <div>
            <h3 className="text-[#8b95a7] text-xs font-bold mb-1 uppercase tracking-wide">المهام قيد الانتظار</h3>
            <p className="text-3xl font-bold text-white font-mono">{pending}</p>
          </div>
        </div>
        
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-6 flex items-center gap-4 shadow-sm hover:shadow-md transition-shadow">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center bg-emerald-50 text-emerald-500 shadow-sm shrink-0">
            <CheckCircle size={22} />
          </div>
          <div>
            <h3 className="text-[#8b95a7] text-xs font-bold mb-1 uppercase tracking-wide">المهام المنجزة</h3>
            <p className="text-3xl font-bold text-white font-mono">{completed}</p>
          </div>
        </div>
      </div>

      {/* Actions List */}
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl overflow-hidden shadow-sm p-6">
        <h3 className="font-bold text-white text-sm mb-4 border-b border-[#222a36] pb-3 flex items-center gap-2">
          <Zap size={16} className="text-amber-500" /> الإجراءات المقترحة لليوم
        </h3>
        
        {actions && actions.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {actions.map((action: any) => {
              const ActionIcon = actionTypeIcons[action.action_type] || Zap
              const isCompleted = action.status === 'completed'
              const iconColorClass = action.action_type === 'whatsapp' ? 'text-emerald-500 bg-emerald-50' : action.action_type === 'call' ? 'text-blue-500 bg-blue-50' : 'text-[#8b95a7] bg-[#222a36]'

              return (
                <div key={action.id} className={`p-5 rounded-2xl border transition-all ${isCompleted ? 'bg-[#0d1117] border-[#222a36] opacity-70' : 'bg-[#151a23] border-blue-100 shadow-sm hover:border-blue-300'}`}>
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconColorClass}`}>
                        <ActionIcon size={18} />
                      </div>
                      <div>
                        <p className="font-bold text-white text-sm">{action.debt?.customer?.full_name}</p>
                        <p className="text-[11px] text-[#5f6b7e] font-mono mt-0.5">ملف: {action.debt?.reference_number}</p>
                        <p className="text-xs text-slate-300 mt-2 font-bold bg-[#222a36] px-2 py-1 rounded-md inline-block border border-[#222a36]">{action.reason}</p>
                        {action.suggested_message && (
                          <div className="mt-3 p-3 bg-[#222a36] border border-[#222a36] rounded-lg text-xs text-[#8b95a7] italic relative">
                            <div className="absolute top-0 end-0 w-1 h-full bg-slate-300 rounded-r-lg"></div>
                            "{action.suggested_message}"
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${isCompleted ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                        {getStatusLabel(action.status)}
                      </span>
                      {action.assigned_to_profile && (
                        <p className="text-[10px] text-[#5f6b7e] font-bold mt-1 bg-[#222a36] px-2 py-0.5 rounded-md">المسؤول: {action.assigned_to_profile.full_name}</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="text-center py-16 bg-[#222a36]/50 rounded-xl">
            <div className="w-16 h-16 bg-[#151a23] border border-[#222a36] shadow-sm rounded-full flex items-center justify-center mx-auto mb-3 text-slate-300">
              <Zap size={24} />
            </div>
            <p className="text-[#8b95a7] text-sm font-bold">لا توجد إجراءات ذكية لهذا اليوم.</p>
            <p className="text-[#5f6b7e] text-xs mt-1">اضغط على زر "توليد الإجراءات" أعلاه لإنشاء خطة عمل يومية.</p>
          </div>
        )}
      </div>
    </div>
  )
}
