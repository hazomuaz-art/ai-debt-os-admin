import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { dateOnlyInTimezone, addDaysToDateString } from '../date-utils'

const HOLIDAY_TRIGGERS: { phrase: string; holidayKey: string; before: boolean }[] = [
  { phrase: 'بعد العيد', holidayKey: 'eid_fitr_or_adha', before: false },
  { phrase: 'قبل العيد', holidayKey: 'eid_fitr_or_adha', before: true },
  { phrase: 'بعد رمضان', holidayKey: 'ramadan_start', before: false },
  { phrase: 'بعد الحج', holidayKey: 'hajj_start', before: false },
  { phrase: 'بعد الاجازة', holidayKey: 'eid_fitr_or_adha', before: false },
  { phrase: 'قبل الاجازة', holidayKey: 'eid_fitr_or_adha', before: true },
]

export const holidayResolver: TemporalResolver = {
  type: 'holiday',
  priorityLevel: 4,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)
    const currentYear = parseInt(todayStr.slice(0, 4), 10)

    for (const trig of HOLIDAY_TRIGGERS) {
      if (!text.includes(trig.phrase)) continue

      const candidates = trig.holidayKey === 'eid_fitr_or_adha'
        ? kb.holidays.filter(h => h.holidayKey === 'eid_fitr' || h.holidayKey === 'eid_adha')
        : kb.holidays.filter(h => h.holidayKey === trig.holidayKey)

      const upcoming = candidates
        .filter(h => h.year === currentYear || h.year === currentYear + 1)
        .filter(h => trig.before ? h.startDate >= todayStr : h.endDate >= todayStr)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))[0]

      if (!upcoming) {
        return {
          referenceType: 'holiday', priorityLevel: 4,
          resolvedDate: null, resolvedTime: null, calendarType: 'gregorian', confidence: 'low',
          requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: true,
          needsClarification: true, clarificationReason: 'holiday_calendar_data_missing',
          matchedRule: `holiday:${trig.holidayKey}:no_kb_data`,
          dataSourcesUsed: [], dataSourcesAvailableButUnused: ['temporal_holidays (no row for this year)'],
          confidenceReason: 'لا توجد بيانات تقويم رسمي محمَّلة لهذه السنة لهذه المناسبة',
        }
      }

      const resolvedDate = trig.before ? addDaysToDateString(upcoming.startDate, -1) : addDaysToDateString(upcoming.endDate, 1)
      return {
        referenceType: 'holiday', priorityLevel: 4,
        resolvedDate, resolvedTime: null, calendarType: 'gregorian', confidence: 'medium',
        requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: true,
        needsClarification: false, clarificationReason: null,
        matchedRule: `holiday:${trig.holidayKey}`,
        dataSourcesUsed: ['temporal_holidays'], dataSourcesAvailableButUnused: [],
        confidenceReason: `محسوب من تقويم العطل الرسمية المسجَّل لـ${upcoming.holidayKey} ${upcoming.year}`,
      }
    }
    return null
  },
}
