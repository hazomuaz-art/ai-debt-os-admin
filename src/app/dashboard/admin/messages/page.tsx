import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { ChatInterface } from '@/components/dashboard/ChatInterface'

export default async function MessagesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('company_id, role').eq('id', user.id).single()
  
  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/collector')

  const { data: messages } = await supabase
    .from('messages')
    .select(`
      id, content, direction, channel, status, sent_at, created_at,
      debt:debts(
        reference_number, current_balance, currency,
        customer:customers(id, full_name, phone, whatsapp)
      )
    `)
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })
    .limit(300)

  const inbound = messages?.filter(m => m.direction === 'inbound').length ?? 0
  const outbound = messages?.filter(m => m.direction === 'outbound').length ?? 0
  const whatsapp = messages?.filter(m => m.channel === 'whatsapp').length ?? 0

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex justify-between items-center mt-6">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3e50] mb-2">المحادثات المباشرة</h1>
          <p className="text-slate-500 text-sm">مراقبة محادثات الذكاء الاصطناعي وإدارة المفاوضات مع العملاء</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-[#e6f0f9] px-4 py-2 rounded-xl border border-blue-100 text-center">
            <div className="text-2xl font-bold text-[#1e3e50]">{whatsapp}</div>
            <div className="text-[10px] text-slate-500 font-bold">رسائل الواتساب</div>
          </div>
          <div className="bg-emerald-50 px-4 py-2 rounded-xl border border-emerald-100 text-center">
            <div className="text-2xl font-bold text-emerald-600">{inbound}</div>
            <div className="text-[10px] text-slate-500 font-bold">واردة من العملاء</div>
          </div>
        </div>
      </div>

      {/* Main Chat App */}
      <ChatInterface initialMessages={messages || []} />
      
    </div>
  )
}
