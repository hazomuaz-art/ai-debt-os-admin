'use client'

import Link from 'next/link'
import type { Profile } from '@/types'
import { useLocale } from '@/lib/i18n'

interface TopbarProps {
  profile: Profile & { company?: { name: string } }
}

export function Topbar({ profile }: TopbarProps) {
  const { t, locale, toggleLocale, formatDate } = useLocale()
  const today = new Date()
  const dateLabel = formatDate(today)

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between px-6 bg-white/80 backdrop-blur-lg border-b border-slate-200 shadow-sm"
      style={{ height: '56px' }}
    >
      {/* Left: search */}
      <div className="flex items-center gap-4 flex-1 max-w-md">
        <div className="flex items-center gap-2.5 flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 focus-within:ring-2 focus-within:ring-brand-100 transition-all">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" className="text-slate-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            placeholder={`${t.common.search}...`}
            className="bg-transparent text-xs text-slate-700 placeholder:text-slate-400 outline-none w-full"
          />
          <span className="text-[10px] text-slate-400 shrink-0 bg-white border border-slate-200 px-1.5 rounded">⌘K</span>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        {/* Date range */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs text-slate-600 bg-slate-50 border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span className="font-medium">{dateLabel}</span>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        {/* Language Switcher */}
        <button
          onClick={toggleLocale}
          className="px-2.5 py-1.5 rounded-xl flex items-center justify-center text-xs font-semibold text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:text-brand-600 transition-all"
          title="Toggle Language"
        >
          {locale === 'ar' ? 'EN' : 'عربي'}
        </button>

        {/* Expand */}
        <button
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all"
          title="Full screen"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>

        {/* Notifications */}
        <Link href="/dashboard/admin/alerts">
          <button className="relative w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-600 hover:bg-slate-50 transition-all">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
            <span
              className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full"
              style={{ background: 'linear-gradient(135deg, #ef4444, #f97316)', boxShadow: '0 0 6px rgba(239,68,68,0.6)' }}
            />
          </button>
        </Link>

        {/* Settings */}
        <Link href="/dashboard/admin/automation">
          <button className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-600 hover:bg-slate-50 transition-all">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M16 12a4 4 0 01-4 4m0-8a4 4 0 014 4M12 2v2M12 20v2M4.22 4.22l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42"/>
            </svg>
          </button>
        </Link>

        {/* User avatar */}
        <div
          className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold text-white cursor-pointer"
          style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            boxShadow: '0 2px 8px rgba(79,70,229,0.3)',
          }}
          title={profile.full_name ?? profile.email}
        >
          {(profile.full_name?.charAt(0) ?? profile.email.charAt(0)).toUpperCase()}
        </div>

        {/* Divider + exit */}
        <div className="w-px h-5 bg-slate-100 mx-1" />
        <button className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-500 hover:bg-slate-50 transition-all" title="Close panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </header>
  )
}
