'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity, Users, MessageCircle, AlertTriangle,
  Wallet, BrainCircuit, CheckCircle, Clock, Search, Bell, Settings, LogOut,
  Layers, Briefcase, DollarSign, BarChart2, ShieldCheck, Megaphone, Link as LinkIcon, Package,
  FlaskConical, TrendingUp, Phone, Brain, Scale, HeartPulse, Building2, LineChart
} from 'lucide-react'
import { logoutAction } from '@/lib/actions/auth'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/i18n'

export function Sidebar({ profile, isPlatformOwner }: { profile: any; isPlatformOwner?: boolean }) {
  const pathname = usePathname()
  const { t, isRTL } = useTranslation()
  const role = profile?.role || 'admin'
  const email = profile?.email || 'admin@max.com'
  const name = profile?.full_name || (isRTL ? 'المدير' : 'Admin')

  // Navigation grouped into sections (Haze style)
  const navGroups = [
    {
      label: t.nav.command_center,
      items: [
        { href: `/dashboard/${role}`, label: t.nav.command_center, icon: Activity, roles: ['admin', 'manager', 'collector'] },
      ],
    },
    {
      label: isRTL ? 'العمليات' : 'Operations',
      items: [
        { href: `/dashboard/${role}/debts`,      label: isRTL ? 'العملاء والمديونيات' : 'Customers & Debts', icon: Layers, roles: ['admin', 'manager', 'collector'] },
        { href: `/dashboard/${role}/ai-actions`, label: t.nav.ai_actions, icon: BrainCircuit, roles: ['admin', 'manager'] },
        { href: `/dashboard/${role}/actions`,    label: t.nav.ai_actions, icon: BrainCircuit, roles: ['collector'] },
        { href: `/dashboard/${role}/messages`,   label: t.nav.messages, icon: MessageCircle, roles: ['admin', 'collector'] },
      ],
    },
    {
      label: isRTL ? 'الإدارة' : 'Management',
      items: [
        { href: `/dashboard/${role}/portfolios`,  label: t.nav.portfolios, icon: Briefcase, roles: ['admin'] },
        { href: `/dashboard/${role}/cost-center`, label: t.nav.cost_center, icon: DollarSign, roles: ['admin'] },
        { href: `/dashboard/${role}/analytics`,   label: t.nav.analytics, icon: BarChart2, roles: ['admin'] },
        { href: `/dashboard/${role}/strategy-insights`, label: isRTL ? 'التحليل الاستراتيجي' : 'Strategy Insights', icon: LineChart, roles: ['admin', 'manager'] },
        { href: `/dashboard/${role}/team`,        label: t.nav.team, icon: ShieldCheck, roles: ['admin', 'manager'] },
        { href: `/dashboard/${role}/campaigns`,   label: t.nav.campaigns, icon: Megaphone, roles: ['admin'] },
        { href: `/dashboard/${role}/payments`,    label: isRTL ? 'المدفوعات' : 'Payments', icon: Wallet, roles: ['admin'] },
        { href: `/dashboard/${role}/promises`,    label: t.nav.promises, icon: CheckCircle, roles: ['admin'] },
        { href: `/dashboard/${role}/approvals`,   label: t.nav.approvals, icon: Clock, roles: ['admin'] },
        { href: `/dashboard/${role}/legal-escalations`, label: isRTL ? 'التصعيدات القانونية' : 'Legal Escalations', icon: Scale, roles: ['admin'] },
      ],
    },
    {
      label: isRTL ? 'الذكاء الاصطناعي' : 'AI Tools',
      items: [
        { href: `/dashboard/${role}/ai-reply-test`, label: isRTL ? 'اختبار الوكيل' : 'Agent Test', icon: FlaskConical, roles: ['admin'] },
        { href: `/dashboard/${role}/ai-revenue`,    label: isRTL ? 'عائدات الذكاء الاصطناعي' : 'AI Revenue', icon: TrendingUp, roles: ['admin'] },
        { href: `/dashboard/${role}/voice`,         label: isRTL ? 'المحصّل الصوتي' : 'Voice Collector', icon: Phone, roles: ['admin'] },
      ],
    },
    {
      label: isRTL ? 'النظام' : 'System',
      items: [
        { href: `/dashboard/${role}/automation`,   label: t.nav.automation, icon: Settings, roles: ['admin'] },
        { href: `/dashboard/${role}/integrations`, label: t.nav.integrations, icon: LinkIcon, roles: ['admin'] },
        { href: `/dashboard/${role}/alerts`,       label: t.nav.alerts, icon: Bell, roles: ['admin'] },
        { href: `/dashboard/${role}/health`,       label: isRTL ? 'صحة النظام' : 'System Health', icon: HeartPulse, roles: ['admin'] },
      ],
    },
    {
      label: isRTL ? 'قيد الربط — قريباً' : 'In Progress — Coming Soon',
      items: [
        { href: `/dashboard/${role}/memory`,          label: isRTL ? 'ذاكرة الذكاء الاصطناعي' : 'AI Memory', icon: Brain, roles: ['admin'], soon: true },
      ],
    },
    ...(isPlatformOwner ? [{
      label: isRTL ? 'منصّة SaaS' : 'SaaS Platform',
      items: [
        { href: `/dashboard/${role}/platform/companies`, label: isRTL ? 'إدارة الشركات' : 'Manage Companies', icon: Building2, roles: ['admin'] },
      ],
    }] : []),
  ].map(g => ({ ...g, items: g.items.filter(i => i.roles.includes(role)) })).filter(g => g.items.length > 0)

  return (
    <aside className="w-60 bg-[#0d1117] border-l border-[#1c2330] flex flex-col shrink-0 z-0 pt-6 pb-4">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-6 mb-6">
        <div className="w-9 h-9 rounded-xl bg-[#10b981] flex items-center justify-center text-white">
          <ShieldCheck size={20} />
        </div>
        <span className="font-bold text-base text-white tracking-tight">AI DEBT OS</span>
      </div>

      {/* Navigation (grouped) */}
      <nav className="flex-1 overflow-y-auto scrollbar-none flex flex-col px-3">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-2">
            <div className="px-3.5 pt-3 pb-1.5 text-[11px] font-bold tracking-wide text-[#5f6b7e]">{group.label}</div>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all w-full text-sm",
                      isActive
                        ? "bg-[#161e2b] text-white font-bold border border-[#23314a]"
                        : "text-[#8b95a7] hover:bg-[#141a24] hover:text-white"
                    )}
                  >
                    <item.icon size={18} strokeWidth={isActive ? 2.5 : 2} className={isActive ? 'text-[#10b981]' : ''} />
                    <span className="flex-1">{item.label}</span>
                    {Boolean((item as { soon?: boolean }).soon) && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-400 shrink-0">
                        {isRTL ? 'قريباً' : 'SOON'}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Profile + logout */}
      <div className="px-3 pt-3 mt-2 border-t border-[#1c2330]">
        <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
          <img src="https://i.pravatar.cc/150?u=admin" alt="Avatar" className="w-9 h-9 rounded-full object-cover" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-white truncate">{name}</div>
            <div className="text-xs text-[#5f6b7e] font-mono truncate">{email}</div>
          </div>
        </div>
        <form action={logoutAction}>
          <button type="submit" className="flex items-center gap-3 px-3.5 py-2.5 w-full text-[#8b95a7] hover:bg-rose-500/10 hover:text-rose-400 rounded-xl transition-colors text-sm">
            <LogOut size={18} />
            <span>{t.common.logout}</span>
          </button>
        </form>
      </div>
    </aside>
  )
}
