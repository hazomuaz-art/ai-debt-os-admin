import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { dateOnlyInTimezone, addDaysToDateString, addMonthsToDateString } from '../date-utils'

export const relativeTimeResolver: TemporalResolver = {
  type: 'relative_time',
  priorityLevel: 5,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)
    const t = text

    function build(resolvedDate: string, matchedRule: string): ResolverMatch {
      return {
        referenceType: 'relative_time', priorityLevel: 5,
        resolvedDate, resolvedTime: null, calendarType: 'gregorian', confidence: 'high',
        requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
        needsClarification: false, clarificationReason: null,
        matchedRule, dataSourcesUsed: ['message_timestamp'], dataSourcesAvailableButUnused: [],
        confidenceReason: 'تعبير زمني نسبي ثابت ومباشر من وقت إرسال الرسالة',
      }
    }

    // Longer/more specific phrases MUST be checked before their shorter
    // substrings ("بعد بكرة" before "بكرة", which it literally contains).
    const fixedByDays: [string, number][] = [
      ['بعد بكرة', 2], ['بعد بكرا', 2], ['بعد غد', 2],
      ['بعد يومين', 2], ['بعد اسبوعين', 14],
      ['بعد يوم', 1], ['بعد اسبوع', 7],
      ['اليوم', 0], ['الحين', 0], ['الان', 0], ['بعد قليل', 0],
      ['بكرة', 1], ['بكرا', 1], ['غدا', 1],
      ['يومين', 2], ['اسبوعين', 14],
      ['ثلاثة ايام', 3], ['ثلاث ايام', 3], ['اربعة ايام', 4], ['خمسة ايام', 5],
      ['ثلاثة اسابيع', 21], ['ثلاث اسابيع', 21],
      ['سنة', 365], ['عام', 365],
    ]
    for (const [phrase, days] of fixedByDays) {
      if (t.includes(phrase)) return build(addDaysToDateString(todayStr, days), `relative_time:fixed_phrase:${phrase}`)
    }

    // Month-based units use CALENDAR month arithmetic (not a flat ~30-day
    // approximation) — "بعد شهرين" means two calendar months later, which a
    // customer/auditor would expect to land on the same day-of-month.
    if (t.includes('بعد شهرين') || t.includes('شهرين')) return build(addMonthsToDateString(todayStr, 2), 'relative_time:months:2')
    if (t.includes('بعد شهر') || /(?:^|\s)شهر(?:\s|$)/.test(t)) return build(addMonthsToDateString(todayStr, 1), 'relative_time:months:1')

    // "بعد N يوم/اسبوع/شهر" — explicit numeral.
    const m = t.match(/(?:خلال|بعد|عقب)\s*(\d+)\s*(يوم|ايام|اسبوع|اسابيع|شهر|شهور|اشهر)/)
    if (m) {
      const n = parseInt(m[1], 10)
      const unit = m[2]
      if (unit.startsWith('شهر') || unit === 'اشهر') return build(addMonthsToDateString(todayStr, n), 'relative_time:numeric_offset_months')
      const days = unit.startsWith('يوم') || unit === 'ايام' ? n : n * 7
      return build(addDaysToDateString(todayStr, days), 'relative_time:numeric_offset_days')
    }

    return null
  },
}
