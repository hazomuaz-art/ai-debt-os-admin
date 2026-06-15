import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { Topbar } from '@/components/dashboard/Topbar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles').select('id, full_name, email, role, company_id').eq('id', user.id).single()

  return (
    <div className="flex h-screen bg-[#0e7a54] text-slate-800 font-sans" >
      {/* Sidebar */}
      <Sidebar profile={profile || {}} />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#e7f6ef] rounded-e-3xl z-10 shadow-[-10px_0_30px_rgba(0,0,0,0.1)]">
        {/* Header */}
        <Topbar profile={profile || {}} />

        {/* Workspace */}
        {children}
      </main>
    </div>
  )
}
