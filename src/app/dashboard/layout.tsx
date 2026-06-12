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
    <div className="flex h-screen bg-[#e6f0f9] text-slate-800 font-sans p-0 sm:p-6 lg:p-10" dir="rtl">
      {/* Outer container matching the presentation mockup style */}
      <div className="flex w-full h-full bg-[#f0f4f8] sm:rounded-[2rem] overflow-hidden shadow-2xl ring-1 ring-slate-900/10 border-4 sm:border-8 border-[#1e3e50]/90">
        
        {/* Sidebar */}
        <Sidebar profile={profile || {}} />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#f0f4f8] rounded-r-3xl z-10 -mr-6">
          {/* Header */}
          <Topbar profile={profile || {}} />

          {/* Workspace */}
          {children}
        </main>
      </div>
    </div>
  )
}
