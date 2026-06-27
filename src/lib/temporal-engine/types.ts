// Temporal Intelligence Engine — public types.
// This file is the ONLY contract the rest of the system needs to know about.

export const TEMPORAL_ENGINE_VERSION = '1.0.0'

export type ReferenceType =
  | 'explicit_date'
  | 'relative_time'
  | 'week_reference'
  | 'month_reference'
  | 'weekday'
  | 'salary'
  | 'gov_program'
  | 'holiday'
  | 'composite'
  | 'approximate'
  | 'unrecognized'

export type Confidence = 'high' | 'medium' | 'low' | null

export interface TemporalExplanation {
  matched_rule: string
  rule_priority_level: number | null
  data_sources_used: string[]
  data_sources_available_but_unused: string[]
  confidence_reason: string
  business_day_adjustment: { applied: boolean; rule: string }
  alternative_interpretations: { resolved_date: string; description_ar: string }[]
}

export interface TemporalResolution {
  resolved: boolean
  resolved_date: string | null        // YYYY-MM-DD
  resolved_time: string | null        // HH:mm, only when meaningfully expressed
  confidence: Confidence
  reference_type: ReferenceType
  source_expression: string
  calendar_type: 'gregorian' | 'hijri'
  requires_customer_data: boolean
  requires_company_policy: boolean
  requires_calendar: boolean
  needs_clarification: boolean
  clarification_reason: string | null
  original_resolved_date: string | null   // before business-day adjustment, if any
  business_day_adjusted: boolean
  explanation: TemporalExplanation
  engine_version: string
  kb_version: string
  learning_logged: boolean
}

// ── Context the caller must supply — never optional on the fields that
//    determine correctness (messageTimestamp especially, see §7 of the
//    architecture: relative expressions resolve from message time, not
//    processing time).
export interface TemporalContext {
  messageTimestamp: Date
  countryCode: string                  // 'SA' today; opens the door to others
  companyId: string | null
  portfolioId: string | null
  customerId: string | null
  debtId: string | null
  customerSalaryDay?: number | null     // from customers.metadata, if known
}

// ── Knowledge Base snapshot shape — what loadTemporalKnowledgeBase()
//    returns. Callers of the engine never touch this directly.
export interface TemporalKnowledgeBase {
  kbVersion: string
  countryConfig: {
    countryCode: string
    defaultTimezone: string
    defaultCalendar: 'gregorian' | 'hijri'
    weekendDays: number[]
    defaultSalaryDay: number | null
  }
  spellingVariants: { canonical: string; variant: string; wordType: string }[]
  holidays: { holidayKey: string; year: number; startDate: string; endDate: string; calendarType: 'gregorian' | 'hijri' }[]
  govPrograms: { programKey: string; displayNameAr: string; payoutDayOfMonth: number | null; companyId: string | null }[]
  compositePatterns: { patternKey: string; baseReferenceType: string; offsetDirection: 'add' | 'subtract' }[]
  businessCalendar: { companyId: string | null; weekendDays: number[] | null; observesPublicHolidays: boolean; fallbackRule: 'next_business_day' | 'previous_business_day' | 'keep_as_is' }[]
}

// ── A single resolver's output, before Layer 3 builds the final object.
export interface ResolverMatch {
  referenceType: ReferenceType
  priorityLevel: number | null
  resolvedDate: string | null
  resolvedTime: string | null
  calendarType: 'gregorian' | 'hijri'
  confidence: Confidence
  requiresCustomerData: boolean
  requiresCompanyPolicy: boolean
  requiresCalendar: boolean
  needsClarification: boolean
  clarificationReason: string | null
  matchedRule: string
  dataSourcesUsed: string[]
  dataSourcesAvailableButUnused: string[]
  confidenceReason: string
  alternativeInterpretations?: { resolved_date: string; description_ar: string }[]
}

export interface TemporalResolver {
  type: ReferenceType
  priorityLevel: number
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null
}
