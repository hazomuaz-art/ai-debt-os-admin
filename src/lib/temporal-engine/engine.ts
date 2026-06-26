import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolution } from './types'
import { TEMPORAL_ENGINE_VERSION } from './types'
import { normalizeTemporalText } from './normalize'
import { applyBusinessCalendarAdjustment } from './business-calendar'
import { captureUnrecognizedExpression } from './learning-capture'

import { explicitDateResolver } from './resolvers/explicit-date'
import { compositeResolver } from './resolvers/composite'
import { salaryResolver } from './resolvers/salary'
import { govProgramResolver } from './resolvers/gov-program'
import { holidayResolver } from './resolvers/holiday'
import { relativeTimeResolver } from './resolvers/relative-time'
import { monthReferenceResolver } from './resolvers/month-reference'
import { weekReferenceResolver } from './resolvers/week-reference'
import { weekdayResolver } from './resolvers/weekday'
import { approximateResolver } from './resolvers/approximate'

// Fixed priority order — a Rule Engine, never an LLM guess. See architecture
// §1 (Rule Engine for multi-reference priority). Composite MUST run before
// the single-purpose resolvers it composes (salary/holiday/month), since a
// phrase like "بعد الراتب بأسبوع" would otherwise be caught by salaryResolver
// alone and lose the "+ أسبوع" offset.
const RESOLVERS_IN_PRIORITY_ORDER = [
  explicitDateResolver,
  compositeResolver,
  salaryResolver,
  govProgramResolver,
  holidayResolver,
  relativeTimeResolver,
  monthReferenceResolver,
  weekReferenceResolver,
  weekdayResolver,
  approximateResolver,
]

// Stub KB for quickScan only — never used for an actual resolution, only to
// let the resolvers run synchronously without a Supabase round-trip. Empty
// KB-sourced fields (holidays/govPrograms/spellingVariants/...) don't block
// a resolver from matching: every resolver returns a non-null match on a
// recognized PHRASE even when the KB row backing the date itself is empty
// (e.g. holidayResolver still matches "بعد العيد" and returns a
// needs_clarification match when kb.holidays is empty) — exactly what
// quickScan needs: "does this look temporal", not "what's the exact date".
const QUICK_SCAN_KB: TemporalKnowledgeBase = {
  kbVersion: 'quick-scan-stub',
  countryConfig: { countryCode: 'SA', defaultTimezone: 'Asia/Riyadh', defaultCalendar: 'gregorian', weekendDays: [5, 6], defaultSalaryDay: null },
  spellingVariants: [], holidays: [], govPrograms: [], compositePatterns: [], businessCalendar: [],
}

// Synchronous, DB-free gate: "does this message look temporal at all?" —
// the ONLY allowed answer to that question is "did any real resolver match
// it", using the exact same resolver list/priority order as the full
// engine. No separate keyword list, no duplicated lexicon — callers that
// need a cheap pre-filter (e.g. Shadow Mode) call this instead of inventing
// their own dictionary.
export function quickScan(rawText: string, messageTimestamp: Date = new Date()): boolean {
  const ctx: TemporalContext = {
    messageTimestamp, countryCode: 'SA',
    companyId: null, portfolioId: null, customerId: null, debtId: null,
    customerSalaryDay: null,
  }
  const normalized = normalizeTemporalText(rawText, QUICK_SCAN_KB)
  return RESOLVERS_IN_PRIORITY_ORDER.some(resolver => resolver.match(normalized, QUICK_SCAN_KB, ctx) !== null)
}

export async function runTemporalEngine(
  rawText: string, context: TemporalContext, kb: TemporalKnowledgeBase,
): Promise<TemporalResolution> {
  const normalized = normalizeTemporalText(rawText, kb)

  let match: ResolverMatch | null = null
  for (const resolver of RESOLVERS_IN_PRIORITY_ORDER) {
    match = resolver.match(normalized, kb, context)
    if (match) break
  }

  if (!match) {
    // Genuinely unrecognized — not even the "approximate" bucket. This is
    // exactly the Learning Capture trigger condition (architecture: only
    // this case, never the already-classified ambiguous/approximate ones).
    await captureUnrecognizedExpression({
      sourceExpression: rawText, fullMessageText: rawText,
      failureReason: 'no_resolver_matched', context,
    })
    return buildResolution({
      referenceType: 'unrecognized', priorityLevel: null, resolvedDate: null, resolvedTime: null,
      calendarType: 'gregorian', confidence: null,
      requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
      needsClarification: true, clarificationReason: 'unrecognized_expression',
      matchedRule: 'none', dataSourcesUsed: [], dataSourcesAvailableButUnused: [],
      confidenceReason: 'لا يوجد resolver يتعرّف على أي بنية زمنية في هذا النص',
    }, rawText, kb, context, true)
  }

  return buildResolution(match, rawText, kb, context, false)
}

function buildResolution(
  match: ResolverMatch, sourceExpression: string, kb: TemporalKnowledgeBase, context: TemporalContext, learningLogged: boolean,
): TemporalResolution {
  let resolvedDate = match.resolvedDate
  let businessDayAdjusted = false
  let originalResolvedDate: string | null = null

  if (resolvedDate) {
    const adjustment = applyBusinessCalendarAdjustment(resolvedDate, kb, context.companyId)
    if (adjustment.adjusted) {
      originalResolvedDate = resolvedDate
      resolvedDate = adjustment.date
      businessDayAdjusted = true
    }
  }

  return {
    resolved: !!resolvedDate,
    resolved_date: resolvedDate,
    resolved_time: match.resolvedTime,
    confidence: match.confidence,
    reference_type: match.referenceType,
    source_expression: sourceExpression,
    calendar_type: match.calendarType,
    requires_customer_data: match.requiresCustomerData,
    requires_company_policy: match.requiresCompanyPolicy,
    requires_calendar: match.requiresCalendar,
    needs_clarification: match.needsClarification,
    clarification_reason: match.clarificationReason,
    original_resolved_date: originalResolvedDate,
    business_day_adjusted: businessDayAdjusted,
    explanation: {
      matched_rule: match.matchedRule,
      rule_priority_level: match.priorityLevel,
      data_sources_used: match.dataSourcesUsed,
      data_sources_available_but_unused: match.dataSourcesAvailableButUnused,
      confidence_reason: match.confidenceReason,
      business_day_adjustment: { applied: businessDayAdjusted, rule: businessDayAdjusted ? 'next_business_day_or_previous' : 'keep_as_is' },
      alternative_interpretations: match.alternativeInterpretations ?? [],
    },
    engine_version: TEMPORAL_ENGINE_VERSION,
    kb_version: kb.kbVersion,
    learning_logged: learningLogged,
  }
}
