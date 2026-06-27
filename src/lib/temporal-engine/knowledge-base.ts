import { createServiceClient } from '@/lib/supabase/server'
import type { TemporalKnowledgeBase } from './types'

// In-process cache — §8 of the architecture: zero DB round-trip per message
// in the common case. TTL chosen because holidays/gov-programs/spelling
// variants change at most a few times a year; a 60-minute staleness window
// updating from an admin panel is acceptable for this category of data.
const CACHE_TTL_MS = 60 * 60 * 1000
const cache = new Map<string, { snapshot: TemporalKnowledgeBase; loadedAt: number }>()

// Bumped manually whenever seed/KB *shape* changes meaningfully enough that
// past resolutions should be distinguishable from future ones in audits.
const KB_SEED_VERSION = '2026.1'

export async function loadTemporalKnowledgeBase(countryCode: string, companyId: string | null): Promise<TemporalKnowledgeBase> {
  const cacheKey = `${countryCode}:${companyId ?? 'default'}`
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.snapshot

  const svc = createServiceClient()

  const [{ data: countryConfigRow }, { data: variants }, { data: holidays }, { data: govPrograms }, { data: patterns }, { data: businessCal }] =
    await Promise.all([
      svc.from('temporal_country_config').select('*').eq('country_code', countryCode).maybeSingle(),
      svc.from('temporal_spelling_variants').select('*').eq('country_code', countryCode).eq('is_active', true),
      svc.from('temporal_holidays').select('*').eq('country_code', countryCode),
      svc.from('temporal_gov_programs').select('*').eq('country_code', countryCode).eq('is_active', true),
      svc.from('temporal_composite_patterns').select('*').eq('country_code', countryCode).eq('is_active', true),
      companyId
        ? svc.from('temporal_business_calendar').select('*').eq('company_id', companyId)
        : Promise.resolve({ data: [] as any[] }),
    ])

  const snapshot: TemporalKnowledgeBase = {
    kbVersion: `${countryCode.toLowerCase()}-${KB_SEED_VERSION}`,
    countryConfig: countryConfigRow
      ? {
          countryCode: countryConfigRow.country_code,
          defaultTimezone: countryConfigRow.default_timezone,
          defaultCalendar: countryConfigRow.default_calendar,
          weekendDays: countryConfigRow.weekend_days ?? [],
          defaultSalaryDay: countryConfigRow.default_salary_day ?? null,
        }
      : { countryCode, defaultTimezone: 'Asia/Riyadh', defaultCalendar: 'gregorian', weekendDays: [5, 6], defaultSalaryDay: null },
    spellingVariants: (variants ?? []).map((v: any) => ({ canonical: v.canonical_word, variant: v.variant_word, wordType: v.word_type })),
    holidays: (holidays ?? []).map((h: any) => ({ holidayKey: h.holiday_key, year: h.year, startDate: h.start_date, endDate: h.end_date, calendarType: h.calendar_type })),
    govPrograms: (govPrograms ?? []).map((p: any) => ({ programKey: p.program_key, displayNameAr: p.display_name_ar, payoutDayOfMonth: p.payout_day_of_month, companyId: p.company_id })),
    compositePatterns: (patterns ?? []).map((p: any) => ({ patternKey: p.pattern_key, baseReferenceType: p.base_reference_type, offsetDirection: p.offset_direction })),
    businessCalendar: (businessCal ?? []).map((b: any) => ({ companyId: b.company_id, weekendDays: b.weekend_days, observesPublicHolidays: b.observes_public_holidays, fallbackRule: b.fallback_rule })),
  }

  cache.set(cacheKey, { snapshot, loadedAt: Date.now() })
  return snapshot
}

// Exposed for tests only — never used by production code paths.
export function __clearTemporalKnowledgeBaseCacheForTests(): void {
  cache.clear()
}
