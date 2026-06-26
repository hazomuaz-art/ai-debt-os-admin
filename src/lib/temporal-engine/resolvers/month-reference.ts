import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { dateOnlyInTimezone, firstOfMonth, lastOfMonth, middleOfMonth, firstOfNextMonth } from '../date-utils'

export const monthReferenceResolver: TemporalResolver = {
  type: 'month_reference',
  priorityLevel: 6,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)
    const t = text

    const next = /(الشهر الجاي|الشهر القادم|الشهر اللي بعده)/.test(t)
    const base = next ? firstOfNextMonth(todayStr) : todayStr

    if (/(هذا الشهر|الشهر الحالي)/.test(t) && !/(بداية|اول|نهاية|اخر|منتصف|نص)/.test(t)) {
      return build(todayStr, 'هذا الشهر/الشهر الحالي — لا حاجة لحساب يوم محدد، يبقى ضمن الشهر الجاري')
    }

    if (/(بداية|اول)\s*(الشهر)/.test(t) || (next && /(بداية|اول)/.test(t))) {
      return build(firstOfMonth(base), 'بداية/أول الشهر')
    }
    if (/(منتصف|نص)\s*(الشهر)/.test(t)) {
      return build(middleOfMonth(base), 'منتصف/نص الشهر')
    }
    if (/(نهاية|اخر)\s*(الشهر)/.test(t) || (next && /(نهاية|اخر)/.test(t))) {
      return build(lastOfMonth(base), 'نهاية/آخر الشهر')
    }
    if (next) {
      return build(firstOfMonth(base), 'الشهر القادم/الجاي بلا تحديد يوم — افتراض أول الشهر القادم')
    }
    return null

    function build(resolvedDate: string, reason: string): ResolverMatch {
      return {
        referenceType: 'month_reference', priorityLevel: 6,
        resolvedDate, resolvedTime: null, calendarType: 'gregorian', confidence: 'high',
        requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
        needsClarification: false, clarificationReason: null,
        matchedRule: 'month_reference:' + reason,
        dataSourcesUsed: ['message_timestamp'], dataSourcesAvailableButUnused: [],
        confidenceReason: reason,
      }
    }
  },
}
