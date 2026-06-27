import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { dateOnlyInTimezone, hijriToGregorian, gregorianToHijriYear } from '../date-utils'
import { toAsciiDigits } from '../normalize'

const GREGORIAN_MONTH_NAMES: Record<string, number> = {
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'ابريل': 4, 'أبريل': 4, 'مايو': 5, 'يونيو': 6,
  'يوليو': 7, 'اغسطس': 8, 'أغسطس': 8, 'سبتمبر': 9, 'اكتوبر': 10, 'أكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
  'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
  'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
}

export const explicitDateResolver: TemporalResolver = {
  type: 'explicit_date',
  priorityLevel: 1,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)
    const tAscii = toAsciiDigits(text)
    const currentYear = parseInt(todayStr.slice(0, 4), 10)

    // YYYY/MM/DD or YYYY-MM-DD
    let m = tAscii.match(/\b(20\d{2})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/)
    if (m) {
      const [, y, mo, d] = m
      const resolved = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
      return build(resolved, 'gregorian', 'تاريخ صريح كامل بصيغة سنة/شهر/يوم')
    }

    // DD/MM/YYYY or DD-MM-YYYY
    m = tAscii.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/)
    if (m) {
      const [, d, mo, y] = m
      const resolved = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
      return build(resolved, 'gregorian', 'تاريخ صريح كامل بصيغة يوم/شهر/سنة')
    }

    // DD/MM (no year) — assume current year, roll to next year if already past.
    m = tAscii.match(/\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})\b/)
    if (m) {
      const d = parseInt(m[1], 10), mo = parseInt(m[2], 10)
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        let year = currentYear
        let resolved = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        if (resolved < todayStr) {
          year += 1
          resolved = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        }
        return build(resolved, 'gregorian', 'تاريخ صريح يوم/شهر بدون سنة — افتُرضت أقرب سنة قادمة')
      }
    }

    // "25 يوليو" / "25 July"
    // NOTE: trailing \b does NOT work after Arabic text in JS regex — \b is
    // defined relative to \w ([A-Za-z0-9_]), and Arabic letters are not \w,
    // so a \b right after an Arabic word at end-of-string/before whitespace
    // never matches. Use a (?=\s|$) lookahead instead — it works for both
    // Arabic and Latin text.
    for (const [name, monthNum] of Object.entries(GREGORIAN_MONTH_NAMES)) {
      const re = new RegExp(`\\b(\\d{1,2})\\s*${name}(?=\\s|$)`, 'i')
      const mm = tAscii.match(re)
      if (mm) {
        const d = parseInt(mm[1], 10)
        let year = currentYear
        let resolved = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}`
        if (resolved < todayStr) { year += 1; resolved = `${year}-${String(monthNum).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
        return build(resolved, 'gregorian', `تاريخ صريح بصيغة "${d} ${name}"`)
      }
    }

    // "١٥ محرم" / "١ رمضان" — Hijri day + month name, no year stated.
    for (const [name, monthNum] of Object.entries(hijriMonthNamesEntries())) {
      const re = new RegExp(`\\b(\\d{1,2})\\s*${name}(?=\\s|$)`)
      const mm = tAscii.match(re)
      if (mm) {
        const d = parseInt(mm[1], 10)
        const approxHijriYear = gregorianToHijriYear(todayStr)
        let resolved = hijriToGregorian(approxHijriYear, monthNum, d)
        if (resolved < todayStr) resolved = hijriToGregorian(approxHijriYear + 1, monthNum, d)
        return {
          referenceType: 'explicit_date', priorityLevel: 1,
          resolvedDate: resolved, resolvedTime: null, calendarType: 'hijri', confidence: 'medium',
          requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: true,
          needsClarification: false, clarificationReason: null,
          matchedRule: `explicit_date:hijri:${name}`,
          dataSourcesUsed: ['hijri_tabular_conversion'],
          dataSourcesAvailableButUnused: [],
          confidenceReason: 'تحويل هجري↔ميلادي تقريبي (تقويم كويتي جدولي)، قد يختلف يوماً واحداً عن تقويم أم القرى الفلكي الرسمي',
        }
      }
    }

    return null

    function build(resolvedDate: string, calendarType: 'gregorian' | 'hijri', reason: string): ResolverMatch {
      return {
        referenceType: 'explicit_date', priorityLevel: 1,
        resolvedDate, resolvedTime: null, calendarType, confidence: 'high',
        requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
        needsClarification: false, clarificationReason: null,
        matchedRule: 'explicit_date:' + reason,
        dataSourcesUsed: ['message_text'], dataSourcesAvailableButUnused: [],
        confidenceReason: reason,
      }
    }
  },
}

function hijriMonthNamesEntries(): Record<string, number> {
  return {
    'محرم': 1, 'صفر': 2, 'ربيع الاول': 3, 'ربيع الثاني': 4,
    'جمادى الاولى': 5, 'جمادى الاخرة': 6, 'رجب': 7, 'شعبان': 8,
    'رمضان': 9, 'شوال': 10, 'ذو القعدة': 11, 'ذو الحجة': 12,
  }
}
