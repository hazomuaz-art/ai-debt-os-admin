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

export function Sidebar({ profile }: { profile: any }) {
  const pathname = usePathname()
  const role = profile?.role || 'admin'
  const email = profile?.email || 'admin@max.com'
  const name = profile?.full_name || 'المدير'

  // Restored full navigation from previous design
  const navItems = [
    { href: `/dashboard/${role}`,               label: 'الرئيسية', icon: Activity },
    { href: `/dashboard/${role}/debts`,          label: 'الديون والملفات', icon: Layers },
    { href: `/dashboard/${role}/customers`,      label: 'العملاء', icon: Users },
    { href: `/dashboard/${role}/ai-actions`,     label: 'إجراءات AI', icon: BrainCircuit },
    { href: `/dashboard/${role}/messages`,       label: 'الرسائل', icon: MessageCircle },
    { href: `/dashboard/${role}/portfolios`,     label: 'المحافظ', icon: Briefcase },
    { href: `/dashboard/${role}/cost-center`,    label: 'مركز التكلفة', icon: DollarSign },
    { href: `/dashboard/${role}/analytics`,      label: 'التحليلات', icon: BarChart2 },
    { href: `/dashboard/${role}/team`,           label: 'فريق العمل', icon: ShieldCheck },
    { href: `/dashboard/${role}/automation`,     label: 'إعدادات الأتمتة', icon: Settings },
    { href: `/dashboard/${role}/campaigns`,      label: 'الحملات', icon: Megaphone },
    { href: `/dashboard/${role}/promises`,       label: 'وعود السداد', icon: CheckCircle },
    { href: `/dashboard/${role}/approvals`,      label: 'الموافقات والتدخل', icon: Clock },
    { href: `/dashboard/${role}/integrations`,   label: 'الربط', icon: LinkIcon },
    { href: `/dashboard/${role}/alerts`,         label: 'التنبيهات', icon: Bell },
  ]

  return (
    <aside className="w-64 bg-[#1e3e50] text-white flex flex-col shrink-0 z-0 pt-8 pb-4">
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
      <nav className="flex-1 overflow-y-auto scrollbar-none flex flex-col gap-1 pr-0 pl-6 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href
          return (
            <Link 
              key={item.href}
              href={item.href} 
              className={cn(
                "flex items-center gap-3 px-6 py-3.5 transition-all w-full",
                isActive 
                  ? "bg-[#f0f4f8] text-[#1e3e50] font-bold rounded-r-full" 
                  : "text-slate-300 hover:bg-white/10 hover:text-white rounded-r-full"
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
          <button type="submit" className="flex items-center gap-3 px-6 py-3 w-full text-slate-300 hover:bg-rose-500/20 hover:text-rose-400 rounded-r-full transition-colors">
            <LogOut size={18} />
            <span className="text-sm">تسجيل الخروج</span>
          </button>
        </form>
      </div>
    </aside>
  )
}
