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
    <aside className="w-64 bg-[#0e7a54] text-white flex flex-col shrink-0 z-0 pt-8 pb-4">
      {/* Profile Section (Matching Image) */}
      <div className="flex flex-col items-center justify-center mb-8 px-4">
        <div className="w-20 h-20 rounded-full border-4 border-white/20 p-1 mb-3">
          <div className="w-full h-full rounded-full bg-slate-300 overflow-hidden flex items-center justify-center">
             <img src="https://i.pravatar.cc/150?u=admin" alt="Avatar" className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="font-bold text-base">{name}</div>
        <div className="text-xs text-slate-300 font-mono mt-0.5">{email}</div>
      </div>
      
      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-none flex flex-col gap-1 pe-0 ps-6 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link 
              key={item.href}
              href={item.href} 
              className={cn(
                "flex items-center gap-3 px-6 py-3.5 transition-all w-full",
                isActive 
                  ? "bg-[#e7f6ef] text-[#0e7a54] font-bold rounded-e-full" 
                  : "text-slate-300 hover:bg-white/10 hover:text-white rounded-e-full"
              )}
            >
              <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-sm">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="pt-4 px-6 mt-4 border-t border-white/10">
        <form action={logoutAction}>
          <button type="submit" className="flex items-center gap-3 px-6 py-3 w-full text-slate-300 hover:bg-rose-500/20 hover:text-rose-400 rounded-e-full transition-colors">
            <LogOut size={18} />
            <span className="text-sm">{t.common.logout}</span>
          </button>
        </form>
      </div>
    </aside>
  )
}
