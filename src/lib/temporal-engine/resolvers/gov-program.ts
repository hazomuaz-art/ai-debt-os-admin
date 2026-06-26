import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { dateOnlyInTimezone, addMonthsToDateString } from '../date-utils'

// Free-text triggers mapped to program_key — the DISPLAY NAME and payout day
// come from the KB (temporal_gov_programs), never hardcoded here. Only the
// "what does the customer's wording refer to" mapping lives in code, since
// that's a language-matching concern, not a policy value.
const TRIGGER_TO_PROGRAM_KEY: Record<string, string> = {
  'حساب المواطن': 'citizen_account',
  'الضمان': 'social_security',
  'ساند': 'saned',
  'التامينات': 'pension', 'التقاعد': 'pension',
  'حافز': 'hafiz',
  'المكافاة': 'hafiz', // student/training stipend — same payout cycle as hafiz in the KB seed; a dedicated program_key can be added via the KB without code changes if needed.
}

function nextPayoutDate(todayStr: string, payoutDay: number): string {
  const [y, m] = todayStr.split('-').map(Number)
  const thisMonth = `${y}-${String(m).padStart(2, '0')}-${String(payoutDay).padStart(2, '0')}`
  return thisMonth >= todayStr ? thisMonth : addMonthsToDateString(thisMonth, 1)
}

export const govProgramResolver: TemporalResolver = {
  type: 'gov_program',
  priorityLevel: 3,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)

    for (const [trigger, programKey] of Object.entries(TRIGGER_TO_PROGRAM_KEY)) {
      if (!text.includes(trigger)) continue

      const program = kb.govPrograms.find(p => p.programKey === programKey && (p.companyId === ctx.companyId || p.companyId === null))
        ?? kb.govPrograms.find(p => p.programKey === programKey && p.companyId === null)

      if (!program || !program.payoutDayOfMonth) {
        return {
          referenceType: 'gov_program', priorityLevel: 3,
          resolvedDate: null, resolvedTime: null, calendarType: 'gregorian', confidence: 'low',
          requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
          needsClarification: true, clarificationReason: 'gov_program_payout_day_unknown',
          matchedRule: `gov_program:${programKey}:no_kb_data`,
          dataSourcesUsed: [], dataSourcesAvailableButUnused: ['temporal_gov_programs (no row for this program)'],
          confidenceReason: `البرنامج "${trigger}" معروف لغوياً لكن لا يوجد يوم إيداع مسجَّل له في قاعدة المعرفة`,
        }
      }

      return {
        referenceType: 'gov_program', priorityLevel: 3,
        resolvedDate: nextPayoutDate(todayStr, program.payoutDayOfMonth), resolvedTime: null,
        calendarType: 'gregorian', confidence: 'medium',
        requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
        needsClarification: false, clarificationReason: null,
        matchedRule: `gov_program:${programKey}`,
        dataSourcesUsed: ['temporal_gov_programs'], dataSourcesAvailableButUnused: [],
        confidenceReason: `يوم الإيداع المعتاد لبرنامج "${program.displayNameAr}" — قد يختلف فعلياً من شهر لآخر`,
      }
    }
    return null
  },
}
