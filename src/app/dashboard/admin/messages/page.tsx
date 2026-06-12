import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { MessageSquare } from 'lucide-react'

export default async function MessagesPage() {
  const supabase = createClient()

  const { data: messages } = await supabase
    .from('messages')
    .select(`
      *,
      debt:debts(reference_number, customer:customers(full_name))
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  const inbound = messages?.filter(m => m.direction === 'inbound').length ?? 0
  const outbound = messages?.filter(m => m.direction === 'outbound').length ?? 0
  const whatsapp = messages?.filter(m => m.channel === 'whatsapp').length ?? 0

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-syne">Messages</h1>
        <p className="text-slate-400">All communication history across channels</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <p className="text-slate-400 text-sm">Total Messages</p>
          <p className="text-2xl font-bold font-syne">{messages?.length ?? 0}</p>
        </div>
        <div className="stat-card">
          <p className="text-slate-400 text-sm">Inbound</p>
          <p className="text-2xl font-bold font-syne text-green-400">{inbound}</p>
        </div>
        <div className="stat-card">
          <p className="text-slate-400 text-sm">WhatsApp</p>
          <p className="text-2xl font-bold font-syne text-brand-400">{whatsapp}</p>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold font-syne mb-4">Message Log</h2>
        {messages && messages.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-200">
                  <th className="pb-3 pr-4">Date</th>
                  <th className="pb-3 pr-4">Customer</th>
                  <th className="pb-3 pr-4">Debt Ref</th>
                  <th className="pb-3 pr-4">Channel</th>
                  <th className="pb-3 pr-4">Direction</th>
                  <th className="pb-3 pr-4">Status</th>
                  <th className="pb-3">Content</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((msg: any) => (
                  <tr key={msg.id} className="border-b border-slate-200">
                    <td className="py-3 pr-4 text-slate-400 whitespace-nowrap">
                      {formatDate(msg.sent_at || msg.created_at)}
                    </td>
                    <td className="py-3 pr-4 font-medium">
                      {msg.debt?.customer?.full_name || '—'}
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-300">
                      {msg.debt?.reference_number || '—'}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        msg.channel === 'whatsapp' ? 'bg-green-500/20 text-green-400' :
                        msg.channel === 'sms' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-slate-500/20 text-slate-400'
                      }`}>
                        {msg.channel}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        msg.direction === 'inbound' ? 'bg-brand-500/20 text-brand-400' : 'bg-slate-500/20 text-slate-400'
                      }`}>
                        {msg.direction}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs ${
                        msg.status === 'delivered' ? 'text-green-400' :
                        msg.status === 'failed' ? 'text-red-400' :
                        'text-slate-400'
                      }`}>
                        {msg.status || 'sent'}
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
            <p className="text-slate-400">No messages yet</p>
          </div>
        )}
      </div>
    </div>
  )
}
