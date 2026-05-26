import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import GenerateActionsButton from '@/components/ai/GenerateActionsButton'

export default async function ManagerAIActionsPage() {
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]

  const { data: actions } = await supabase
    .from('ai_actions')
    .select(`
      *,
      debt:debts(reference_number, customer:customers(full_name, phone)),
      assigned_to_profile:profiles!ai_actions_assigned_to_fkey(full_name)
    `)
    .eq('scheduled_for', today)
    .order('priority_score', { ascending: false })

  const pending = actions?.filter(a => a.status === 'pending').length ?? 0
  const completed = actions?.filter(a => a.status === 'completed').length ?? 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-syne">AI Actions</h1>
          <p className="text-slate-400">Today's recommended actions for your team</p>
        </div>
        <GenerateActionsButton />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="stat-card"><p className="text-slate-400 text-sm">Pending</p><p className="text-2xl font-bold font-syne text-yellow-400">{pending}</p></div>
        <div className="stat-card"><p className="text-slate-400 text-sm">Completed</p><p className="text-2xl font-bold font-syne text-green-400">{completed}</p></div>
      </div>

      <div className="card">
        {actions && actions.length > 0 ? (
          <div className="space-y-3">
            {actions.map((action: any) => (
              <div key={action.id} className="p-4 bg-surface-100 rounded-lg border border-surface-200">
                <div className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <p className="font-semibold">{action.debt?.customer?.full_name}</p>
                    <p className="text-xs text-slate-400 font-mono">{action.debt?.reference_number}</p>
                    <p className="text-sm text-slate-300 mt-1">{action.action_type}: {action.reason}</p>
                    {action.suggested_message && (
                      <p className="text-xs text-slate-400 mt-1 italic">"{action.suggested_message}"</p>
                    )}
                  </div>
                  <div className="text-right">
                    <span className={`text-xs px-2 py-0.5 rounded ${action.status === 'completed' ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                      {action.status}
                    </span>
                    {action.assigned_to_profile && (
                      <p className="text-xs text-slate-400 mt-1">{action.assigned_to_profile.full_name}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-400 text-center py-12">No actions for today. Click "Generate Actions" to create an AI action plan.</p>
        )}
      </div>
    </div>
  )
}
