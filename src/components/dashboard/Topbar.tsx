'use client'

import { Search, Bell, Globe } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/lib/i18n'

export function Topbar({ profile }: { profile: any }) {
  const { t, locale, toggleLocale } = useTranslation()
  const name = profile?.full_name?.split(' ')[0] || 'المدير'
  const role = profile?.role || 'admin'
  const alertsHref = role === 'admin' ? '/dashboard/admin/alerts' : `/dashboard/${role}`

  return (
    <header className="bg-[#0d1117] border-b border-[#1c2330] py-4 px-8 flex justify-between items-center shrink-0 z-10 print:hidden">
      <div className="flex-1">
        <h1 className="text-xl font-bold text-white tracking-tight">{locale === 'ar' ? `مرحباً بك ${name} !` : `Welcome ${name}!`}</h1>
      </div>

      <div className="flex-1 flex justify-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute end-4 top-2.5 text-[#5f6b7e]" size={18} />
          <input
            type="text"
            placeholder={t.common.search}
            className="w-full bg-[#161b22] border border-[#222a36] text-slate-200 rounded-full pe-12 ps-4 py-2 text-sm focus:outline-none focus:border-[#10b981] placeholder:text-[#5f6b7e]"
          />
        </div>
      </div>

      <div className="flex-1 flex justify-end items-center gap-3">
        {/* Language Switcher */}
        <button
          onClick={toggleLocale}
          className="flex items-center gap-2 bg-[#10b981]/10 text-[#34d399] px-3 py-1.5 rounded-full hover:bg-[#10b981]/20 transition-colors"
        >
          <Globe size={16} />
          <span className="text-sm font-semibold">{locale === 'ar' ? 'EN' : 'عربي'}</span>
        </button>

        <Link href={alertsHref} aria-label={t.nav.alerts} className="relative p-2 text-[#8b95a7] hover:text-white bg-[#161b22] rounded-full border border-[#222a36] inline-flex">
          <Bell size={18} />
          <span className="absolute top-1 end-1 w-2 h-2 bg-rose-500 rounded-full border border-[#0d1117]"></span>
        </Link>
      </div>
    </header>
  )
}
