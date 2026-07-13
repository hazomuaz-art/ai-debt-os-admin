import type { Metadata } from 'next'
import { Inter, Syne, JetBrains_Mono, IBM_Plex_Sans_Arabic } from 'next/font/google'
import { LanguageProvider } from '@/lib/i18n'
import { getServerLocale } from '@/lib/i18n/server'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
})

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  weight: ['300', '400', '500', '600', '700'],
  subsets: ['arabic'],
  variable: '--font-ibm-plex',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AI DEBT OS — Intelligent Debt Collection Platform',
  description: 'AI-powered debt collection and management platform for modern financial institutions',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const locale = await getServerLocale()
  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  return (
    <html lang={locale} dir={dir}>
      <body className={`${inter.variable} ${syne.variable} ${jetbrainsMono.variable} ${ibmPlexArabic.variable} font-sans bg-slate-950 text-slate-100 antialiased`}>
        <LanguageProvider>
          {children}
        </LanguageProvider>
      </body>
    </html>
  )
}
