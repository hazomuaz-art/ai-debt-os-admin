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

  const isPlatformOwner = !!profile?.company_id && profile.company_id === process.env.PLATFORM_OWNER_COMPANY_ID

  return (
    <div className="flex h-screen bg-[#0b0e14] text-slate-200 font-sans" >
      {/* Sidebar */}
      <Sidebar profile={profile || {}} isPlatformOwner={isPlatformOwner} />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#0b0e14] z-10">
        {/* Header */}
        <Topbar profile={profile || {}} />

        {/* Workspace */}
        {children}
      </main>
    </div>
  )
}
