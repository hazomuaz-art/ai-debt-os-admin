'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { logoutAction } from '@/lib/actions/auth'
import type { Profile } from '@/types'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/i18n'

interface SidebarProps {
  profile: Profile & { company?: { name: string } }
}

const adminNav = [
  { href: '/dashboard/admin',               labelKey: 'command_center', icon: 'grid',       group: 'core' },
  { href: '/dashboard/admin/debts',          labelKey: 'debts',         icon: 'layers',     group: 'core' },
  { href: '/dashboard/admin/customers',      labelKey: 'customers',     icon: 'users',      group: 'core' },
  { href: '/dashboard/admin/ai-actions',     labelKey: 'ai_actions',    icon: 'zap',        group: 'core' },
  { href: '/dashboard/admin/messages',       labelKey: 'messages',      icon: 'message',    group: 'core' },
  { href: '/dashboard/admin/portfolios',     labelKey: 'portfolios',    icon: 'briefcase',  group: 'data' },
  { href: '/dashboard/admin/cost-center',    labelKey: 'cost_center',   icon: 'dollar',     group: 'data' },
  { href: '/dashboard/admin/analytics',      labelKey: 'analytics',     icon: 'chart',      group: 'data' },
  { href: '/dashboard/admin/ai-revenue',     labelKey: 'ai_revenue',    icon: 'dollar',     group: 'data' },
  { href: '/dashboard/admin/team',           labelKey: 'team',          icon: 'shield',     group: 'data' },
  { href: '/dashboard/admin/automation',     labelKey: 'automation',    icon: 'cpu',        group: 'ai' },
  { href: '/dashboard/admin/campaigns',      labelKey: 'campaigns',     icon: 'megaphone',  group: 'ai' },
  { href: '/dashboard/admin/promises',       labelKey: 'promises',      icon: 'check',      group: 'ai' },
  { href: '/dashboard/admin/approvals',      labelKey: 'approvals',     icon: 'clock',      group: 'ai' },
  { href: '/dashboard/admin/integrations',   labelKey: 'integrations',  icon: 'link',       group: 'system' },
  { href: '/dashboard/admin/alerts',         labelKey: 'alerts',        icon: 'bell',       group: 'system' },
  { href: '/dashboard/admin/memory',         labelKey: 'memory',        icon: 'brain',      group: 'system' },
  { href: '/dashboard/admin/knowledge-base', labelKey: 'knowledge_base',icon: 'book',       group: 'system' },
  { href: '/dashboard/admin/rules',          labelKey: 'rules',         icon: 'cpu',        group: 'system' },
  { href: '/dashboard/admin/health',         labelKey: 'health',        icon: 'shield',     group: 'system' },
  { href: '/dashboard/admin/platform',       labelKey: 'platform',      icon: 'package',    group: 'system' },
]

const managerNav = [
  { href: '/dashboard/manager',             labelKey: 'command_center', icon: 'grid' },
  { href: '/dashboard/manager/debts',       labelKey: 'debts',      icon: 'layers' },
  { href: '/dashboard/manager/customers',   labelKey: 'customers',  icon: 'users' },
  { href: '/dashboard/manager/ai-actions',  labelKey: 'ai_actions', icon: 'zap' },
  { href: '/dashboard/manager/team',        labelKey: 'team',       icon: 'shield' },
]

const collectorNav = [
  { href: '/dashboard/collector',           labelKey: 'command_center', icon: 'grid' },
  { href: '/dashboard/collector/debts',     labelKey: 'debts',      icon: 'layers' },
  { href: '/dashboard/collector/actions',   labelKey: 'ai_actions', icon: 'zap' },
  { href: '/dashboard/collector/messages',  labelKey: 'messages',   icon: 'message' },
]

// Icon paths
const NAV_ICONS: Record<string, string> = {
  grid:      'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z',
  layers:    'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  users:     'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  zap:       'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
  message:   'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
  briefcase: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2',
  dollar:    'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  chart:     'M18 20V10M12 20V4M6 20v-6',
  shield:    'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  cpu:       'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
  megaphone: 'M18 8a5 5 0 010 8M2 11v2M10.18 4.87l-1.37.6A6 6 0 006 11v2a6 6 0 002.81 5.07l1.37.6c1.68.74 3.62-.36 3.62-2.19V7.06c0-1.83-1.94-2.93-3.62-2.19z',
  check:     'M20 6L9 17l-5-5',
  clock:     'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 6v6l4 2',
  link:      'M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71',
  bell:      'M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0',
  brain:     'M12 5c1.5-2 4.5-2 6 0s1.5 4 0 5c-1 .7-2 1-3 1M12 5c-1.5-2-4.5-2-6 0s-1.5 4 0 5c1 .7 2 1 3 1M9 11c0 3 1.5 5 3 7M15 11c0 3-1.5 5-3 7M9 11c-1 2-1 5 0 7M15 11c1 2 1 5 0 7',
  book:      'M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 014 17V5a2 2 0 012-2h14v14H6.5a2.5 2.5 0 00-2.5 2.5z',
  package:   'M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
}

function NavIcon({ name, size = 15, className }: { name: string; size?: number; className?: string }) {
  const d = NAV_ICONS[name] ?? NAV_ICONS.grid
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0", className)}>
      <path d={d} />
    </svg>
  )
}

export function Sidebar({ profile }: SidebarProps) {
  const { t, isRTL } = useLocale()
  const pathname = usePathname()
  const isAdmin = profile.role === 'admin'
  const company = (profile.company as { name: string } | undefined)?.name ?? ''
  const initial = (profile.full_name?.charAt(0) ?? profile.email.charAt(0)).toUpperCase()
  const roleColor = profile.role === 'admin' ? 'from-brand-500 to-indigo-500' :
                    profile.role === 'manager' ? 'from-purple-500 to-pink-500' :
                    'from-emerald-500 to-teal-500'

  const GROUP_LABELS: Record<string, string> = {
    core:   t.nav.command_center,
    data:   t.nav.analytics,
    ai:     t.nav.automation,
    system: t.nav.settings,
  }

  // Find active group based on current URL path
  const currentGroup = useMemo(() => {
    if (!pathname) return 'core'
    const found = adminNav.find(item => pathname.startsWith(item.href))
    return found?.group ?? 'core'
  }, [pathname])

  const [activeGroup, setActiveGroup] = useState<string>('core')

  useEffect(() => {
    if (currentGroup) {
      setActiveGroup(currentGroup)
    }
  }, [currentGroup])

  const menuGroups = [
    { id: 'core',   label: t.nav.command_center, icon: 'grid' },
    { id: 'data',   label: t.nav.analytics,      icon: 'briefcase' },
    { id: 'ai',     label: t.nav.automation,     icon: 'zap' },
    { id: 'system', label: t.nav.settings,       icon: 'cpu' },
  ]

  return (
    <aside
      className="flex h-screen sticky top-0 shrink-0 bg-slate-950/85 backdrop-blur-2xl border-r border-white/5"
      style={{
        width: '240px',
        direction: isRTL ? 'rtl' : 'ltr',
        borderRight: isRTL ? 'none' : undefined,
        borderLeft: isRTL ? '1px solid rgba(255,255,255,0.05)' : undefined,
      }}
    >
      {/* ── STAGE 1: Narrow vertical icon strip (Admin Only) ── */}
      {isAdmin && (
        <div className="w-[60px] flex flex-col items-center py-4 border-r border-white/5 justify-between shrink-0 bg-slate-950/40">
          {/* Logo */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center relative overflow-hidden shadow-glow-brand"
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>

          {/* Group Tabs */}
          <div className="flex-1 flex flex-col gap-3.5 items-center justify-center mt-6 w-full px-1">
            {menuGroups.map(group => {
              const isActive = activeGroup === group.id
              return (
                <button
                  key={group.id}
                  onClick={() => setActiveGroup(group.id)}
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 group relative",
                    isActive 
                      ? "text-white bg-white/5 border border-white/10 shadow-glow-brand" 
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                  title={group.label}
                >
                  <NavIcon name={group.icon} size={16} />
                  {/* Indicator bar */}
                  {isActive && (
                    <span 
                      className={cn(
                        "absolute w-1 h-5 rounded-full bg-brand-400 top-2.5",
                        isRTL ? "right-0" : "left-0"
                      )} 
                    />
                  )}
                </button>
              )
            })}
          </div>

          {/* User profile initials block */}
          <div className="flex flex-col gap-3 items-center">
            <div
              className={cn(
                "w-8 h-8 rounded-full bg-gradient-to-br flex items-center justify-center text-xs font-bold text-white shadow-glow-brand cursor-pointer",
                roleColor
              )}
              title={profile.full_name ?? profile.email}
            >
              {initial}
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                title="Sign out"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── STAGE 2: Navigation Links Column ── */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Header Title based on Active Group */}
        <div className="px-4 py-4.5 border-b border-white/5 flex flex-col justify-center">
          <div className="flex items-center gap-2">
            {!isAdmin && (
              <div className="w-6 h-6 rounded-lg bg-gradient-brand flex items-center justify-center shrink-0">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
            )}
            <div className="min-w-0">
              <span className="font-display font-bold text-xs tracking-wider text-slate-100 uppercase">
                {isAdmin ? GROUP_LABELS[activeGroup] : 'AI DEBT OS'}
              </span>
              <p className="text-[9px] text-slate-400 truncate mt-0.5 tracking-wide font-medium uppercase">
                {company || 'Workspace'}
              </p>
            </div>
          </div>
        </div>

        {/* Links Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 scrollbar-none space-y-1">
          {isAdmin ? (
            adminNav
              .filter(item => item.group === activeGroup)
              .map(item => {
                const isActive = pathname === item.href
                return (
                  <Link 
                    key={item.href} 
                    href={item.href} 
                    prefetch={true} 
                    className={cn(
                      "sidebar-link flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border border-transparent",
                      isActive 
                        ? "text-white bg-gradient-brand border-white/10 shadow-glow-brand" 
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    )}
                  >
                    <NavIcon name={item.icon} size={14} className={isActive ? "text-white" : "text-slate-400"} />
                    <span className="truncate">{t.nav[item.labelKey as keyof typeof t.nav] || item.labelKey}</span>
                  </Link>
                )
              })
          ) : (
            // Non-admins navigation
            (profile.role === 'manager' ? managerNav : collectorNav).map(item => {
              const isActive = pathname === item.href
              return (
                <Link 
                  key={item.href} 
                  href={item.href} 
                  prefetch={true} 
                  className={cn(
                    "sidebar-link flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all duration-200 border border-transparent",
                    isActive 
                      ? "text-white bg-gradient-brand border-white/10 shadow-glow-brand" 
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  )}
                >
                  <NavIcon name={item.icon} size={14} className={isActive ? "text-white" : "text-slate-400"} />
                  <span className="truncate">{t.nav[item.labelKey as keyof typeof t.nav] || item.labelKey}</span>
                </Link>
              )
            })
          )}
        </nav>

        {/* Status Indicator */}
        <div className="p-3 border-t border-white/5">
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <div className="flex-1 min-w-0">
              <span className="block text-[9px] font-bold text-emerald-400 tracking-wider">SECURE LINK</span>
              <span className="block text-[8px] text-slate-400 truncate">V2.0 Core Active</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
