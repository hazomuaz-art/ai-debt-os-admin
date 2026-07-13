import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate, getStatusColor, formatCurrency } from '@/lib/utils'
import { InviteUserModal } from '@/components/dashboard/InviteUserModal'
import { MemberActions } from '@/components/dashboard/MemberActions'
import { Users, Activity, CheckCircle, Wallet } from 'lucide-react'

export default async function AdminTeamPage() {
  const supabase = await createClient()
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
    admin: 'bg-rose-50 text-rose-600 border-rose-200',
    manager: 'bg-purple-50 text-purple-600 border-purple-200',
    collector: 'bg-blue-50 text-blue-600 border-blue-200',
  }

  const roleArabic = {
    admin: 'مدير نظام',
    manager: 'مشرف تحصيل',
    collector: 'موظف تحصيل',
  }

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0">
            <Users size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">إدارة فريق العمل (Team)</h1>
            <p className="text-[#8b95a7] text-sm">إدارة الموظفين، الصلاحيات، ومتابعة الأداء الشهري</p>
          </div>
        </div>
        
        <InviteUserModal companyId={profile.company_id} />
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {memberStats.map(member => (
          <div key={member.id} className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 hover:shadow-md transition-shadow flex flex-col">
            
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-[#222a36] text-white rounded-full flex items-center justify-center font-bold text-xl shrink-0">
                  {member.full_name?.charAt(0) ?? member.email.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="font-bold text-white text-lg">{member.full_name ?? 'بدون اسم'}</div>
                  <div className="text-[#5f6b7e] text-xs font-mono">{member.email}</div>
                </div>
              </div>
              <span className={`inline-flex px-3 py-1 rounded-lg text-xs font-bold border ${roleColors[member.role as keyof typeof roleColors] ?? 'bg-[#222a36] text-[#8b95a7]'}`}>
                {roleArabic[member.role as keyof typeof roleArabic] ?? member.role}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-[#0b0e14] rounded-xl p-3 text-center">
                <div className="text-[#8b95a7] font-bold text-[10px] mb-1 flex items-center justify-center gap-1"><Activity size={12}/> المسندة</div>
                <div className="font-bold text-white text-xl font-mono">{member.assignedDebts}</div>
              </div>
              <div className="bg-[#0b0e14] rounded-xl p-3 text-center">
                <div className="text-[#8b95a7] font-bold text-[10px] mb-1 flex items-center justify-center gap-1"><Wallet size={12}/> تم التحصيل</div>
                <div className="font-bold text-emerald-600 text-xl font-mono">
                  {formatCurrency(member.collectedThisMonth, 'SAR').replace('SAR', '').trim()}
                </div>
              </div>
              <div className="bg-[#0b0e14] rounded-xl p-3 text-center">
                <div className="text-[#8b95a7] font-bold text-[10px] mb-1 flex items-center justify-center gap-1"><CheckCircle size={12}/> أُنجزت اليوم</div>
                <div className="font-bold text-blue-600 text-xl font-mono">{member.actionsCompletedToday}</div>
              </div>
            </div>

            <div className="mt-auto">
              <MemberActions 
                memberId={member.id} 
                currentRole={member.role} 
                isActive={member.is_active} 
                currentUserId={user.id} 
              />
            </div>

          </div>
        ))}
      </div>
    </div>
  )
}
