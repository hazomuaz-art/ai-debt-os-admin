import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ChatInterface } from '@/components/dashboard/ChatInterface'
import { getServerTranslation } from '@/lib/i18n/server'

export default async function MessagesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('company_id, role').eq('id', user.id).single()
  
  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/collector')

  const { data: messages } = await supabase
    .from('messages')
    .select(`
      id, content, direction, channel, status, sent_at, created_at,
      customer:customers(id, full_name, phone, whatsapp, ai_paused),
      debt:debts(id, reference_number, current_balance, currency)
    `)
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: false })
    .limit(300)

  // Real gap found during a full-system audit: these used to be computed off
  // the same 300-row-capped `messages` array shown in the chat list — once a
  // company passes 300 total messages, both counters silently undercount
  // (same bug class already fixed once in analytics.tsx's dual "collected"
  // computation). Exact counts via a separate head-only query, independent
  // of the display list's cap.
  const [{ count: inbound }, { count: whatsapp }] = await Promise.all([
    supabase.from('messages').select('*', { count: 'exact', head: true })
      .eq('company_id', profile.company_id).eq('direction', 'inbound'),
    supabase.from('messages').select('*', { count: 'exact', head: true })
      .eq('company_id', profile.company_id).eq('channel', 'whatsapp'),
  ])
  const { t, dir } = await getServerTranslation()
  const m = t.pages.messages

  return (
    <div dir={dir} className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >

      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex justify-between items-center mt-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">{m.title}</h1>
          <p className="text-[#8b95a7] text-sm">{m.subtitle}</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-[#0d1117] px-4 py-2 rounded-xl border border-[#222a36] text-center">
            <div className="text-2xl font-bold text-white">{whatsapp ?? 0}</div>
            <div className="text-[10px] text-[#8b95a7] font-bold">{m.whatsapp_msgs}</div>
          </div>
          <div className="bg-emerald-500/10 px-4 py-2 rounded-xl border border-emerald-500/20 text-center">
            <div className="text-2xl font-bold text-emerald-400">{inbound ?? 0}</div>
            <div className="text-[10px] text-[#8b95a7] font-bold">{m.inbound_from_customers}</div>
          </div>
        </div>
      </div>

      {/* Main Chat App */}
      <ChatInterface initialMessages={messages || []} />
      
    </div>
  )
}
