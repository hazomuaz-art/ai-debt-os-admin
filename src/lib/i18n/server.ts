// Server-side translation helper.
// Reads the `locale` cookie (set by the client LanguageProvider) so that
// async Server Components can render in the correct language.
import { cookies } from 'next/headers'
import { translations, type Locale, type TranslationKeys } from './translations'

export function getServerLocale(): Locale {
  const value = cookies().get('locale')?.value
  return value === 'en' ? 'en' : 'ar'
}

export function getServerTranslation(): {
  t: TranslationKeys
  locale: Locale
  dir: 'rtl' | 'ltr'
  isRTL: boolean
} {
  const locale = getServerLocale()
  return {
    t: translations[locale],
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    isRTL: locale === 'ar',
  }
}
