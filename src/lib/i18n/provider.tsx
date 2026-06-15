'use client'

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { translations, type Locale, type TranslationKeys } from './translations'

type TranslationContextType = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TranslationKeys
  dir: 'rtl' | 'ltr'
  isRTL: boolean
  toggleLocale: () => void
  formatCurrency: (amount: number) => string
  formatNumber: (num: number) => string
  formatDate: (date: Date | string) => string
}

const TranslationContext = createContext<TranslationContextType | null>(null)

function getStoredLocale(): Locale {
  if (typeof window === 'undefined') return 'ar'
  const cookieMatch = document.cookie.match(/(?:^|; )locale=(ar|en)/)
  if (cookieMatch) return cookieMatch[1] as Locale
  return (localStorage.getItem('ai-debt-os-locale') as Locale) || 'ar'
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ar')
  const [mounted, setMounted] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setLocaleState(getStoredLocale())
    setMounted(true)
  }, [])

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    localStorage.setItem('ai-debt-os-locale', newLocale)
    // Cookie lets Server Components read the locale; refresh re-renders them.
    document.cookie = `locale=${newLocale}; path=/; max-age=31536000`
    document.documentElement.lang = newLocale
    document.documentElement.dir = newLocale === 'ar' ? 'rtl' : 'ltr'
    router.refresh()
  }, [router])

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'ar' ? 'en' : 'ar')
  }, [locale, setLocale])

  const formatCurrency = useCallback((amount: number) => {
    const formatted = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount)
    return locale === 'ar' ? `${formatted} ر.س` : `SAR ${formatted}`
  }, [locale])

  const formatNumber = useCallback((num: number) => {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-SA').format(num)
  }, [locale])

  const formatDate = useCallback((date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-SA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(d)
  }, [locale])

  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  const isRTL = locale === 'ar'
  const t = translations[locale]

  // Set initial direction
  useEffect(() => {
    if (mounted) {
      document.documentElement.lang = locale
      document.documentElement.dir = dir
    }
  }, [locale, dir, mounted])

  return (
    <TranslationContext.Provider value={{ locale, setLocale, t, dir, isRTL, toggleLocale, formatCurrency, formatNumber, formatDate }}>
      {children}
    </TranslationContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(TranslationContext)
  if (!context) {
    throw new Error('useTranslation must be used within a LanguageProvider')
  }
  return context
}

export function useLocale() {
  return useTranslation()
}
