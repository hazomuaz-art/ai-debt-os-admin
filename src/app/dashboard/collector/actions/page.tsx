import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getStatusColor, formatCurrency } from '@/lib/utils'
import { CompleteActionButton } from '@/components/ai/CompleteActionButton'
import { SendWhatsAppButton } from '@/components/ai/SendWhatsAppButton'

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

  const actionTypeIcons: Record<string, string> = {
    call: '📞', whatsapp: '💬', email: '✉️', visit: '🚶',
    legal: '⚖️', escalate: '🔺', settle: '✅',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Today&apos;s Actions</h1>
        <p className="text-white/40 text-sm">{done} done · {pending} pending</p>
      </div>

      <div className="space-y-3">
        {(actions ?? []).length === 0 ? (
          <div className="card p-12 text-center text-white/30">
            <div className="text-3xl mb-2">◆</div>
            <div>No actions scheduled for today. Check back later.</div>
          </div>
        ) : (actions ?? []).map(action => (
          <div key={action.id} className={`card p-4 ${action.status === 'completed' ? 'opacity-40' : ''}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className="text-2xl mt-0.5">{actionTypeIcons[action.action_type] ?? '◆'}</div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{(action.customer as {full_name?: string} | null)?.full_name}</span>
                    <span className={`status-badge text-[10px] ${getStatusColor(action.priority)}`}>{action.priority}</span>
                  </div>
                  <div className="text-white/50 text-sm mt-1">{action.reason}</div>
                  {action.suggested_message && (
                    <div className="mt-2 p-3 bg-white/3 rounded-lg border border-white/5 text-white/70 text-sm">
                      {action.suggested_message}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-xs text-white/30">
                    {action.best_time_to_contact && <span>⏰ {action.best_time_to_contact}</span>}
                    <span>{formatCurrency((action.debt as {current_balance: number; currency: string} | null)?.current_balance ?? 0, (action.debt as {currency: string} | null)?.currency ?? 'SAR')}</span>
                  </div>
                </div>
              </div>
              {action.status !== 'completed' && (
                <div className="flex flex-col gap-2">
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
                </div>
              )}
              {action.status === 'completed' && (
                <span className="text-green-400 text-xs font-medium">✓ Done</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
