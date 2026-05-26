import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/dashboard/Sidebar'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, company:companies(name, slug, plan)')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar profile={profile} />
      <main className="flex-1 overflow-y-auto bg-surface-950">
        <div className="p-6 max-w-7xl mx-auto animate-in">
          {children}
        </div>
      </main>
    </div>
  )
}
