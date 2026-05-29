import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate } from '@/lib/utils'
import { MessageSquare } from 'lucide-react'

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

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-syne">Messages</h1>
        <p className="text-slate-400">Communication history for your assigned debts</p>
      </div>

      <div className="card">
        {messages && messages.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-surface-200">
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Customer</th>
                  <th className="pb-3 pr-4">Ref</th>
                  <th className="pb-3 pr-4">Channel</th>
                  <th className="pb-3 pr-4">Direction</th>
                  <th className="pb-3">Content</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((msg: any) => (
                  <tr key={msg.id} className="border-b border-surface-100">
                    <td className="py-3 pr-4 text-slate-400 whitespace-nowrap">{formatDate(msg.sent_at || msg.created_at)}</td>
                    <td className="py-3 pr-4 font-medium">{(msg.debt as any)?.customer?.full_name || '—'}</td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-300">{(msg.debt as any)?.reference_number || '—'}</td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs ${msg.channel === 'whatsapp' ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>
                        {msg.channel}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs ${msg.direction === 'inbound' ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-500/20 text-slate-400'}`}>
                        {msg.direction}
                      </span>
                    </td>
                    <td className="py-3 max-w-xs truncate text-slate-300">{msg.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12">
            <MessageSquare className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-400">No messages for your assigned debts</p>
          </div>
        )}
      </div>
    </div>
  )
}
