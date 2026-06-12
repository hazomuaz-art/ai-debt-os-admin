import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatCurrency, getStatusColor } from '@/lib/utils'
import { GenerateActionsButton } from '@/components/ai/GenerateActionsButton'
import { CompleteActionButton } from '@/components/ai/CompleteActionButton'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'

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

  const actionTypeIcons: Record<string, string> = {
    call: '📞', whatsapp: '💬', email: '✉️', visit: '🚶',
    legal: '⚖️', escalate: '🔺', settle: '✅',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">AI Action Plan</h1>
          <p className="text-slate-500 text-sm">
            {today} — {completedCount}/{(actions ?? []).length} completed
          </p>
        </div>
        <GenerateActionsButton />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['critical', 'high', 'medium', 'low'] as const).map(priority => (
          <div key={priority} className={`card p-3 border ${getStatusColor(priority)}`}>
            <div className="text-xs font-medium uppercase tracking-wider mb-1">{priority}</div>
            <div className="font-display text-2xl font-bold">{priorityCounts[priority] ?? 0}</div>
          </div>
        ))}
      </div>

      {/* Actions list */}
      <div className="space-y-3">
        {(actions ?? []).length === 0 ? (
          <div className="card p-12 text-center">
            <div className="text-4xl mb-3">◆</div>
            <div className="font-display font-semibold mb-2">No AI Actions Generated</div>
            <p className="text-slate-500 text-sm mb-4">Click &quot;Generate AI Plan&quot; to create today&apos;s action plan</p>
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
          <div key={action.id} className={`card p-4 ${action.status === 'completed' ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className="text-2xl">{actionTypeIcons[action.action_type] ?? '◆'}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{(action.customer as {full_name?: string} | null)?.full_name ?? 'Unknown'}</span>
                    <span className={`status-badge text-[10px] ${getStatusColor(action.priority)}`}>
                      {action.priority}
                    </span>
                    <span className="text-slate-400 text-xs font-mono">{(action.debt as {reference_number?: string} | null)?.reference_number}</span>
                  </div>
                  <div className="text-slate-500 text-sm mt-1">{action.reason}</div>
                  {action.suggested_message && (
                    <div className="mt-2 p-3 bg-white/3 rounded-lg border border-slate-200">
                      <div className="text-slate-400 text-[10px] uppercase tracking-wider mb-1">Suggested Message</div>
                      <div className="text-slate-600 text-sm">{action.suggested_message}</div>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {action.best_time_to_contact && (
                      <span className="text-slate-400 text-xs">⏰ {action.best_time_to_contact}</span>
                    )}
                    {(action.debt as {current_balance?: number; currency?: string} | null)?.current_balance && (
                      <span className="text-slate-400 text-xs">
                        {formatCurrency((action.debt as {current_balance: number; currency: string}).current_balance, (action.debt as {currency: string}).currency)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {action.status !== 'completed' && (
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
                )}
                {action.status === 'completed' && (
                  <span className="text-green-400 text-xs font-medium">✓ Done</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
