import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { dateOnlyInTimezone, addMonthsToDateString } from '../date-utils'

function nextSalaryDate(todayStr: string, salaryDay: number): string {
  const [y, m] = todayStr.split('-').map(Number)
  const thisMonth = `${y}-${String(m).padStart(2, '0')}-${String(salaryDay).padStart(2, '0')}`
  return thisMonth >= todayStr ? thisMonth : addMonthsToDateString(thisMonth, 1)
}

export const salaryResolver: TemporalResolver = {
  type: 'salary',
  priorityLevel: 3,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    if (!/(الراتب|راتب|معاش)/.test(text)) return null
    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)

    if (ctx.customerSalaryDay) {
      return {
        referenceType: 'salary', priorityLevel: 3,
        resolvedDate: nextSalaryDate(todayStr, ctx.customerSalaryDay), resolvedTime: null,
        calendarType: 'gregorian', confidence: 'high',
        requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
        needsClarification: false, clarificationReason: null,
        matchedRule: 'salary:customer_salary_day_known',
        dataSourcesUsed: ['customers.metadata.salary_day'], dataSourcesAvailableButUnused: [],
        confidenceReason: 'يوم الراتب معروف ومسجَّل لهذا العميل تحديداً',
      }
    }

    if (kb.countryConfig.defaultSalaryDay) {
      return {
        referenceType: 'salary', priorityLevel: 3,
        resolvedDate: nextSalaryDate(todayStr, kb.countryConfig.defaultSalaryDay), resolvedTime: null,
        calendarType: 'gregorian', confidence: 'medium',
        requiresCustomerData: true, requiresCompanyPolicy: false, requiresCalendar: false,
        needsClarification: false, clarificationReason: null,
        matchedRule: 'salary:country_default_salary_day',
        dataSourcesUsed: ['temporal_country_config.default_salary_day'],
        dataSourcesAvailableButUnused: ['customers.metadata.salary_day (not set)'],
        confidenceReason: 'لا يوجد يوم راتب مسجَّل لهذا العميل تحديداً، استُخدم الافتراضي العام للدولة',
      }
    }

    return {
      referenceType: 'salary', priorityLevel: 3,
      resolvedDate: null, resolvedTime: null, calendarType: 'gregorian', confidence: 'low',
      requiresCustomerData: true, requiresCompanyPolicy: false, requiresCalendar: false,
      needsClarification: true, clarificationReason: 'salary_day_unknown',
      matchedRule: 'salary:no_data_available',
      dataSourcesUsed: [], dataSourcesAvailableButUnused: ['customers.metadata.salary_day (not set)', 'temporal_country_config.default_salary_day (not set)'],
      confidenceReason: 'لا توجد أي بيانات (للعميل أو افتراضي للدولة) لتحديد يوم الراتب',
    }
  },
}
