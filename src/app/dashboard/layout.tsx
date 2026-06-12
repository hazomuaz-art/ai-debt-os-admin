import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/dashboard/Sidebar'
import { Topbar } from '@/components/dashboard/Topbar'
import { DashboardFooter } from '@/components/dashboard/Footer'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // TEMPORARY: Mock profile for UI preview
  const profile = {
    id: 'mock-id',
    full_name: 'Admin User',
    email: 'admin@aidebtos.com',
    role: 'admin',
    company: { name: 'DebtCorp UI Preview' },
  } as any

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <Sidebar profile={profile} />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Topbar */}
        <Topbar profile={profile} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6 max-w-screen-2xl mx-auto animate-in">
            {children}
          </div>
          <DashboardFooter />
        </main>
      </div>
    </div>
  )
}
