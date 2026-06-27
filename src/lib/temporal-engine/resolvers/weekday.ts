import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { dateOnlyInTimezone, nextWeekdayOnOrAfter } from '../date-utils'

const WEEKDAYS = ['السبت', 'الاحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعة']

export const weekdayResolver: TemporalResolver = {
  type: 'weekday',
  priorityLevel: 7,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)
    for (const wd of WEEKDAYS) {
      if (text.includes(wd)) {
        const resolved = nextWeekdayOnOrAfter(todayStr, wd)
        if (!resolved) continue
        return {
          referenceType: 'weekday', priorityLevel: 7,
          resolvedDate: resolved, resolvedTime: null, calendarType: 'gregorian', confidence: 'high',
          requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
          needsClarification: false, clarificationReason: null,
          matchedRule: `weekday:${wd}`,
          dataSourcesUsed: ['message_timestamp'], dataSourcesAvailableButUnused: [],
          confidenceReason: `أقرب ${wd} قادم بعد تاريخ رسالة العميل`,
        }
      }
    }
    return null
  },
}
