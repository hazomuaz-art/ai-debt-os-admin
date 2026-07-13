// Server-side translation helper.
// Reads the `locale` cookie (set by the client LanguageProvider) so that
// async Server Components can render in the correct language.
import { cookies } from 'next/headers'
import { translations, type Locale, type TranslationKeys } from './translations'

export async function getServerLocale(): Promise<Locale> {
  const value = (await cookies()).get('locale')?.value
  return value === 'en' ? 'en' : 'ar'
}

export async function getServerTranslation(): Promise<{
  t: TranslationKeys
  locale: Locale
  dir: 'rtl' | 'ltr'
  isRTL: boolean
}> {
  const locale = await getServerLocale()
  return {
    t: translations[locale] as TranslationKeys,
    locale,
    dir: locale === 'ar' ? 'rtl' : 'ltr',
    isRTL: locale === 'ar',
  }
}
