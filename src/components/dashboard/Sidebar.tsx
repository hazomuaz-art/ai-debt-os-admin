'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { 
  Activity, Users, MessageCircle, AlertTriangle, 
  Wallet, BrainCircuit, CheckCircle, Clock, Search, Bell, Settings, LogOut,
  Layers, Briefcase, DollarSign, BarChart2, ShieldCheck, Megaphone, Link as LinkIcon, Book, Package
} from 'lucide-react'
import { logoutAction } from '@/lib/actions/auth'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'

export function Sidebar({ profile }: { profile: any }) {
  const pathname = usePathname()
  const { t, isRTL } = useTranslation()
  const role = profile?.role || 'admin'
  const email = profile?.email || 'admin@max.com'
  const name = profile?.full_name || (isRTL ? 'المدير' : 'Admin')

  // Restored full navigation from previous design
  const navItems = [
    { href: `/dashboard/${role}`,               label: t.nav.command_center, icon: Activity, roles: ['admin', 'manager', 'collector'] },
    { href: `/dashboard/${role}/debts`,          label: t.nav.debts, icon: Layers, roles: ['admin', 'manager', 'collector'] },
    { href: `/dashboard/${role}/customers`,      label: t.nav.customers, icon: Users, roles: ['admin', 'manager'] },
    { href: `/dashboard/${role}/ai-actions`,     label: t.nav.ai_actions, icon: BrainCircuit, roles: ['admin', 'manager'] },
    { href: `/dashboard/${role}/actions`,        label: t.nav.ai_actions, icon: BrainCircuit, roles: ['collector'] },
    { href: `/dashboard/${role}/messages`,       label: t.nav.messages, icon: MessageCircle, roles: ['admin', 'collector'] },
    { href: `/dashboard/${role}/portfolios`,     label: t.nav.portfolios, icon: Briefcase, roles: ['admin'] },
    { href: `/dashboard/${role}/cost-center`,    label: t.nav.cost_center, icon: DollarSign, roles: ['admin'] },
    { href: `/dashboard/${role}/analytics`,      label: t.nav.analytics, icon: BarChart2, roles: ['admin'] },
    { href: `/dashboard/${role}/team`,           label: t.nav.team, icon: ShieldCheck, roles: ['admin', 'manager'] },
    { href: `/dashboard/${role}/automation`,     label: t.nav.automation, icon: Settings, roles: ['admin'] },
    { href: `/dashboard/${role}/campaigns`,      label: t.nav.campaigns, icon: Megaphone, roles: ['admin'] },
    { href: `/dashboard/${role}/promises`,       label: t.nav.promises, icon: CheckCircle, roles: ['admin'] },
    { href: `/dashboard/${role}/approvals`,      label: t.nav.approvals, icon: Clock, roles: ['admin'] },
    { href: `/dashboard/${role}/integrations`,   label: t.nav.integrations, icon: LinkIcon, roles: ['admin'] },
    { href: `/dashboard/${role}/alerts`,         label: t.nav.alerts, icon: Bell, roles: ['admin'] },
  ].filter(item => item.roles.includes(role))

  return (
    <aside className="w-60 bg-white border-l border-slate-100 flex flex-col shrink-0 z-0 pt-6 pb-4">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-6 mb-7">
        <div className="w-9 h-9 rounded-xl bg-[#0e9f6e] flex items-center justify-center text-white">
          <ShieldCheck size={20} />
        </div>
        <span className="font-bold text-base text-slate-800">ديون أو إس</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-none flex flex-col gap-0.5 px-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all w-full text-sm",
                isActive
                  ? "bg-[#e7f6ef] text-[#0e7a54] font-bold"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"
              )}
            >
              <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Profile + logout */}
      <div className="px-3 pt-3 mt-3 border-t border-slate-100">
        <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
          <img src="https://i.pravatar.cc/150?u=admin" alt="Avatar" className="w-9 h-9 rounded-full object-cover" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800 truncate">{name}</div>
            <div className="text-xs text-slate-400 font-mono truncate">{email}</div>
          </div>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="flex items-center gap-3 px-3.5 py-2.5 w-full text-slate-500 hover:bg-rose-50 hover:text-rose-500 rounded-xl transition-colors text-sm">
            <LogOut size={18} />
            <span>{t.common.logout}</span>
          </button>
        </form>
      </div>
    </aside>
  )
}
