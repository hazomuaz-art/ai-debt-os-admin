'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logoutAction } from '@/lib/actions/auth'
import type { Profile } from '@/types'
import { cn } from '@/lib/utils'

interface SidebarProps {
  profile: Profile & { company?: { name: string } }
}

const adminNav = [
  { href: '/dashboard/admin', label: 'Overview', icon: '⊞' },
  { href: '/dashboard/admin/debts', label: 'Debts', icon: '◈' },
  { href: '/dashboard/admin/customers', label: 'Customers', icon: '◉' },
  { href: '/dashboard/admin/ai-actions', label: 'AI Actions', icon: '◆' },
  { href: '/dashboard/admin/team', label: 'Team', icon: '◎' },
  { href: '/dashboard/admin/messages', label: 'Messages', icon: '◇' },
  { href: '/dashboard/admin/analytics', label: 'Analytics', icon: '◐' },
  { href: '/dashboard/admin/activity',     label: 'Activity',     icon: '◌' },
  { href: '/dashboard/admin/integrations', label: 'Integrations', icon: '⬡' },
]

const managerNav = [
  { href: '/dashboard/manager', label: 'Overview', icon: '⊞' },
  { href: '/dashboard/manager/debts', label: 'Debts', icon: '◈' },
  { href: '/dashboard/manager/customers', label: 'Customers', icon: '◉' },
  { href: '/dashboard/manager/ai-actions', label: 'AI Actions', icon: '◆' },
  { href: '/dashboard/manager/team', label: 'Team', icon: '◎' },
]

const collectorNav = [
  { href: '/dashboard/collector', label: 'My Queue', icon: '⊞' },
  { href: '/dashboard/collector/debts', label: 'My Debts', icon: '◈' },
  { href: '/dashboard/collector/actions', label: 'Actions', icon: '◆' },
  { href: '/dashboard/collector/messages', label: 'Messages', icon: '◇' },
]

export function Sidebar({ profile }: SidebarProps) {
  const pathname = usePathname()

  const nav = profile.role === 'admin' ? adminNav :
              profile.role === 'manager' ? managerNav : collectorNav

  const roleColors = {
    admin: 'bg-brand-600/20 text-brand-400 border-brand-600/30',
    manager: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
    collector: 'bg-green-600/20 text-green-400 border-green-600/30',
  }

  return (
    <aside className="w-64 bg-surface-900 border-r border-white/5 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center font-display font-bold text-sm">
            Ω
          </div>
          <div>
            <div className="font-display font-semibold text-sm leading-tight">AI Debt OS</div>
            <div className="text-white/30 text-xs truncate max-w-[140px]">{(profile.company as {name: string} | undefined)?.name ?? 'Loading...'}</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
        {nav.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'sidebar-link',
              pathname === item.href && 'active'
            )}
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* User info */}
      <div className="p-3 border-t border-white/5">
        <div className="flex items-center gap-3 p-2 rounded-lg mb-1">
          <div className="w-8 h-8 bg-brand-800 rounded-full flex items-center justify-center text-sm font-semibold">
            {profile.full_name?.charAt(0) ?? profile.email.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{profile.full_name ?? 'User'}</div>
            <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border', roleColors[profile.role])}>
              {profile.role}
            </span>
          </div>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="sidebar-link w-full justify-start text-red-400/60 hover:text-red-400 hover:bg-red-500/5">
            <span>↩</span> Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
