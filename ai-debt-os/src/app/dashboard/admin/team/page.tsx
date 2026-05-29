import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate, getStatusColor, formatCurrency } from '@/lib/utils'
import { InviteUserModal } from '@/components/dashboard/InviteUserModal'

export default async function AdminTeamPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/collector')

  const today = new Date().toISOString().split('T')[0]
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const { data: members } = await supabase
    .from('profiles')
    .select('*')
    .eq('company_id', profile.company_id)
    .order('created_at', { ascending: true })

  // Get stats per member
  const memberStats = await Promise.all((members ?? []).map(async member => {
    const [
      { count: assignedDebts },
      { data: payments },
      { count: actionsCompleted },
    ] = await Promise.all([
      supabase.from('debts').select('*', { count: 'exact', head: true }).eq('assigned_to', member.id).neq('status', 'settled'),
      supabase.from('payments').select('amount').eq('recorded_by', member.id).gte('payment_date', monthStart),
      supabase.from('ai_actions').select('*', { count: 'exact', head: true }).eq('assigned_to', member.id).eq('status', 'completed').eq('scheduled_for', today),
    ])

    return {
      ...member,
      assignedDebts: assignedDebts ?? 0,
      collectedThisMonth: payments?.reduce((s, p) => s + p.amount, 0) ?? 0,
      actionsCompletedToday: actionsCompleted ?? 0,
    }
  }))

  const roleColors = {
    admin: 'bg-brand-600/20 text-brand-400 border-brand-600/30',
    manager: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
    collector: 'bg-green-600/20 text-green-400 border-green-600/30',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Team</h1>
          <p className="text-white/40 text-sm">{memberStats.length} team members</p>
        </div>
        <InviteUserModal companyId={profile.company_id} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {memberStats.map(member => (
          <div key={member.id} className="card p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-brand-800/50 rounded-full flex items-center justify-center font-semibold">
                  {member.full_name?.charAt(0) ?? member.email.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-medium">{member.full_name ?? 'Unnamed'}</div>
                  <div className="text-white/40 text-xs">{member.email}</div>
                </div>
              </div>
              <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-medium border ${roleColors[member.role as keyof typeof roleColors]}`}>
                {member.role}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-white/3 rounded-lg p-2">
                <div className="font-display font-bold text-lg">{member.assignedDebts}</div>
                <div className="text-white/30 text-[10px]">Assigned</div>
              </div>
              <div className="bg-white/3 rounded-lg p-2">
                <div className="font-display font-bold text-lg text-green-400">
                  {formatCurrency(member.collectedThisMonth, 'SAR').replace('SAR', '').trim()}
                </div>
                <div className="text-white/30 text-[10px]">Collected</div>
              </div>
              <div className="bg-white/3 rounded-lg p-2">
                <div className="font-display font-bold text-lg text-brand-400">{member.actionsCompletedToday}</div>
                <div className="text-white/30 text-[10px]">Actions</div>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className={`inline-flex items-center gap-1.5 text-xs ${member.is_active ? 'text-green-400' : 'text-white/30'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${member.is_active ? 'bg-green-400' : 'bg-white/20'}`} />
                {member.is_active ? 'Active' : 'Inactive'}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
