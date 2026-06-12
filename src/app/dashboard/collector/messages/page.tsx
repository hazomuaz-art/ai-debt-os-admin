import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { MessageSquare, MessageCircle, Mail, Smartphone, ArrowDownRight, ArrowUpRight } from 'lucide-react'

export default async function CollectorMessagesPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Get only debts assigned to this collector
  const { data: assignedDebts } = await supabase
    .from('debts')
    .select('id')
    .eq('assigned_to', user.id)

  const debtIds = assignedDebts?.map(d => d.id) ?? []

  const { data: messages } = debtIds.length > 0
    ? await supabase
        .from('messages')
        .select(`*, debt:debts(reference_number, customer:customers(full_name))`)
        .in('debt_id', debtIds)
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [] }

  const getChannelIcon = (channel: string) => {
    switch (channel) {
      case 'whatsapp': return <MessageCircle size={16} className="text-emerald-500" />
      case 'sms': return <Smartphone size={16} className="text-blue-500" />
      case 'email': return <Mail size={16} className="text-rose-500" />
      default: return <MessageSquare size={16} className="text-slate-500" />
    }
  }

  const getChannelLabel = (channel: string) => {
    switch (channel) {
      case 'whatsapp': return 'واتساب'
      case 'sms': return 'رسالة نصية'
      case 'email': return 'بريد إلكتروني'
      default: return channel
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center gap-4 mt-6">
        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
          <MessageSquare size={24} />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">سجل المراسلات</h1>
          <p className="text-slate-500 text-sm font-medium">سجل التواصل لجميع ملفات الديون المسندة إليك</p>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        {messages && messages.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-[#fbfdfd] border-b border-slate-100 text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-bold">التاريخ</th>
                  <th className="px-6 py-4 font-bold">العميل ورقم الملف</th>
                  <th className="px-6 py-4 font-bold text-center">القناة</th>
                  <th className="px-6 py-4 font-bold text-center">الاتجاه</th>
                  <th className="px-6 py-4 font-bold w-1/3">محتوى الرسالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {messages.map((msg: any) => (
                  <tr key={msg.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-slate-600 font-medium whitespace-nowrap">
                      {formatDate(msg.sent_at || msg.created_at)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-[#1e3e50] text-sm mb-0.5">{(msg.debt as any)?.customer?.full_name || '—'}</div>
                      <div className="text-slate-400 text-xs font-mono">{(msg.debt as any)?.reference_number || '—'}</div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-100">
                        {getChannelIcon(msg.channel)}
                        <span className="text-xs font-bold text-slate-600">{getChannelLabel(msg.channel)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold ${
                        msg.direction === 'inbound' 
                          ? 'bg-blue-50 text-blue-600 border border-blue-100' 
                          : 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                      }`}>
                        {msg.direction === 'inbound' ? (
                          <><ArrowDownRight size={14} /> واردة</>
                        ) : (
                          <><ArrowUpRight size={14} /> صادرة</>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="bg-[#fcfdfd] border border-slate-100 p-3 rounded-xl text-slate-600 text-sm leading-relaxed truncate max-w-sm hover:max-w-none hover:whitespace-normal transition-all cursor-default">
                        {msg.content}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-20 h-20 bg-slate-50 text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
              <MessageSquare size={32} />
            </div>
            <h3 className="font-bold text-lg text-[#1e3e50] mb-2">لا توجد رسائل مسجلة</h3>
            <p className="text-slate-500 text-sm">لم يتم إرسال أو استقبال أي رسائل للديون المسندة إليك بعد.</p>
          </div>
        )}
      </div>
    </div>
  )
}
