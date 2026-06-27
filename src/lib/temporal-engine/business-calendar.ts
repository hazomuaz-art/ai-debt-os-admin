import type { TemporalKnowledgeBase } from './types'
import { addDaysToDateString, isWeekendDay } from './date-utils'

export function applyBusinessCalendarAdjustment(
  resolvedDate: string, kb: TemporalKnowledgeBase, companyId: string | null,
): { date: string; adjusted: boolean; rule: string } {
  const companyCal = companyId ? kb.businessCalendar.find(b => b.companyId === companyId) : undefined
  const fallbackRule = companyCal?.fallbackRule ?? 'keep_as_is'
  const weekendDays = companyCal?.weekendDays ?? kb.countryConfig.weekendDays

  if (fallbackRule === 'keep_as_is') return { date: resolvedDate, adjusted: false, rule: fallbackRule }
  if (!isWeekendDay(resolvedDate, weekendDays)) return { date: resolvedDate, adjusted: false, rule: fallbackRule }

  const step = fallbackRule === 'next_business_day' ? 1 : -1
  let candidate = resolvedDate
  for (let i = 0; i < 7; i++) {
    candidate = addDaysToDateString(candidate, step)
    if (!isWeekendDay(candidate, weekendDays)) break
  }
  return { date: candidate, adjusted: true, rule: fallbackRule }
}
