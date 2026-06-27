import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { dateOnlyInTimezone, startOfWeek, endOfWeek, addDaysToDateString } from '../date-utils'

export const weekReferenceResolver: TemporalResolver = {
  type: 'week_reference',
  priorityLevel: 6,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    // Only fire when "الشهر" isn't also present — monthReferenceResolver
    // owns "بداية الشهر" etc.; this resolver owns the week variants only.
    if (!/(الاسبوع)/.test(text)) return null

    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)
    const t = text

    const next = /(الاسبوع الجاي|الاسبوع القادم|الاسبوع اللي بعده)/.test(t)
    const base = next ? addDaysToDateString(startOfWeek(todayStr), 7) : todayStr

    if (/(هذا الاسبوع|الاسبوع الحالي)/.test(t) && !/(بداية|اول|نهاية|منتصف)/.test(t)) {
      return build(todayStr, 'هذا الأسبوع/الأسبوع الحالي')
    }
    if (/(بداية|اول)\s*(الاسبوع)/.test(t) || (next && /(بداية|اول)/.test(t))) {
      return build(startOfWeek(base), 'بداية/أول الأسبوع')
    }
    if (/منتصف\s*(الاسبوع)/.test(t)) {
      return build(addDaysToDateString(startOfWeek(todayStr), 3), 'منتصف الأسبوع')
    }
    if (/نهاية\s*(الاسبوع)/.test(t) || (next && /نهاية/.test(t))) {
      return build(endOfWeek(base), 'نهاية الأسبوع')
    }
    if (next) {
      return build(startOfWeek(base), 'الأسبوع القادم/الجاي بلا تحديد يوم — افتراض بدايته')
    }
    return null

    function build(resolvedDate: string, reason: string): ResolverMatch {
      return {
        referenceType: 'week_reference', priorityLevel: 6,
        resolvedDate, resolvedTime: null, calendarType: 'gregorian', confidence: 'high',
        requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
        needsClarification: false, clarificationReason: null,
        matchedRule: 'week_reference:' + reason,
        dataSourcesUsed: ['message_timestamp'], dataSourcesAvailableButUnused: [],
        confidenceReason: reason,
      }
    }
  },
}
