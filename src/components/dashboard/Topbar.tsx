'use client'

import { Search, Bell, Globe } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

export function Topbar({ profile }: { profile: any }) {
  const { t, locale, toggleLocale } = useTranslation()
  const name = profile?.full_name?.split(' ')[0] || 'المدير'

  return (
    <header className="bg-white border-b border-slate-100 py-4 px-8 flex justify-between items-center shrink-0 z-10">
      <div className="flex-1">
        <h1 className="text-xl font-bold text-slate-800 tracking-tight">{locale === 'ar' ? `مرحباً بك ${name} !` : `Welcome ${name}!`}</h1>
      </div>

      <div className="flex-1 flex justify-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute end-4 top-2.5 text-slate-400" size={18} />
          <input
            type="text"
            placeholder={t.common.search}
            className="w-full bg-[#f7f8fa] border border-slate-100 text-slate-700 rounded-full pe-12 ps-4 py-2 text-sm focus:outline-none focus:border-[#0e9f6e]"
          />
        </div>
      </div>

      <div className="flex-1 flex justify-end items-center gap-3">
        {/* Language Switcher */}
        <button
          onClick={toggleLocale}
          className="flex items-center gap-2 bg-[#e7f6ef] text-[#0e7a54] px-3 py-1.5 rounded-full hover:bg-[#d9f0e6] transition-colors"
        >
          <Globe size={16} />
          <span className="text-sm font-semibold">{locale === 'ar' ? 'EN' : 'عربي'}</span>
        </button>

        <button className="relative p-2 text-slate-500 hover:text-[#0e7a54] bg-[#f7f8fa] rounded-full border border-slate-100">
          <Bell size={18} />
          <span className="absolute top-1 end-1 w-2 h-2 bg-rose-500 rounded-full border border-white"></span>
        </button>
      </div>
    </header>
  )
}
