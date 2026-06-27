import type { ResolverMatch, TemporalContext, TemporalKnowledgeBase, TemporalResolver } from '../types'
import { addDaysToDateString, dateOnlyInTimezone, firstOfMonth, firstOfNextMonth } from '../date-utils'
import { salaryResolver } from './salary'
import { holidayResolver } from './holiday'
import { monthReferenceResolver } from './month-reference'

// Known multi-reference templates ONLY — never an inferred combination.
// Each template here corresponds to a `temporal_composite_patterns` row;
// the KB controls whether a pattern is active/described, this code
// implements the finite set of recognized SHAPES. Adding a genuinely new
// composite SHAPE (not just enabling/tuning an existing one) requires a
// code change here — a documented, deliberate scope limit, not an oversight.
function parseOffsetDays(text: string): number | null {
  // (?=\s|$) instead of trailing \b — \b doesn't fire after Arabic text
  // (it's defined relative to \w, and Arabic letters aren't \w). Covers
  // BOTH the attached preposition form ("باسبوع") and the separate-word
  // form ("بعد اسبوعين" / "خلال اسبوعين").
  const m = text.match(/(?:ب|بعد|خلال)\s*(اسبوعين|اسبوع|يومين|يوم|شهر)(?=\s|$)|(\d+)\s*(يوم|اسبوع)/)
  if (!m) return null
  const unit = m[1] ?? m[3]
  const num = m[2] ? parseInt(m[2], 10) : null
  if (unit === 'اسبوع') return num ? num * 7 : 7
  if (unit === 'اسبوعين') return 14
  if (unit === 'يوم') return num ?? 1
  if (unit === 'يومين') return 2
  if (unit === 'شهر') return 30
  return null
}

export const compositeResolver: TemporalResolver = {
  type: 'composite',
  priorityLevel: 2,
  match(text: string, kb: TemporalKnowledgeBase, ctx: TemporalContext): ResolverMatch | null {
    const todayStr = dateOnlyInTimezone(ctx.messageTimestamp, kb.countryConfig.defaultTimezone)

    // ── True ambiguity: "أو" between two resolvable alternatives ──
    if (/\sاو\s/.test(text)) {
      const [leftRaw, rightRaw] = text.split(/\sاو\s/)
      const left = monthReferenceResolver.match(leftRaw, kb, ctx)
      const right = monthReferenceResolver.match(rightRaw, kb, ctx)
      if (left?.resolvedDate && right?.resolvedDate && left.resolvedDate !== right.resolvedDate) {
        return {
          referenceType: 'composite', priorityLevel: 2,
          resolvedDate: null, resolvedTime: null, calendarType: 'gregorian', confidence: 'low',
          requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
          needsClarification: true, clarificationReason: 'ambiguous_or_reference',
          matchedRule: 'composite:ambiguous_or',
          dataSourcesUsed: [], dataSourcesAvailableButUnused: [],
          confidenceReason: 'الرسالة تحتوي بديلين زمنيين حقيقيين بأداة "أو" — لا قرار حتمي ممكن بينهما',
          alternativeInterpretations: [
            { resolved_date: left.resolvedDate, description_ar: leftRaw.trim() },
            { resolved_date: right.resolvedDate, description_ar: rightRaw.trim() },
          ],
        }
      }
    }

    // ── "بعد الراتب بأسبوع" / "بعد الراتب باسبوعين" — salary + offset ──
    if (/الراتب/.test(text) && /ب\s*(اسبوع|اسبوعين|يوم|يومين)/.test(text)) {
      const base = salaryResolver.match(text, kb, ctx)
      const offsetDays = parseOffsetDays(text)
      if (base?.resolvedDate && offsetDays) {
        return {
          ...base, referenceType: 'composite', priorityLevel: 2,
          resolvedDate: addDaysToDateString(base.resolvedDate, offsetDays),
          matchedRule: 'composite:salary_then_offset',
          confidenceReason: `${base.confidenceReason} — مع إضافة ${offsetDays} يوماً بعد الراتب`,
        }
      }
      if (base) return { ...base, referenceType: 'composite', matchedRule: 'composite:salary_then_offset_missing_base' }
    }

    // ── "بعد الإجازة/العيد بأسبوع" — holiday + offset ──
    if (/(العيد|الاجازة|رمضان|الحج)/.test(text) && /ب\s*(اسبوع|اسبوعين|يوم|يومين)/.test(text)) {
      const base = holidayResolver.match(text, kb, ctx)
      const offsetDays = parseOffsetDays(text)
      if (base?.resolvedDate && offsetDays) {
        return {
          ...base, referenceType: 'composite', priorityLevel: 2,
          resolvedDate: addDaysToDateString(base.resolvedDate, offsetDays),
          matchedRule: 'composite:holiday_then_offset',
          confidenceReason: `${base.confidenceReason} — مع إضافة ${offsetDays} يوماً بعد العطلة`,
        }
      }
      if (base) return { ...base, referenceType: 'composite', matchedRule: 'composite:holiday_then_offset_missing_base' }
    }

    // ── "أول الشهر بعد العيد" — month-start that falls after a holiday ──
    if (/(الشهر)/.test(text) && /(بداية|اول)/.test(text) && /(العيد|الاجازة|رمضان|الحج)/.test(text)) {
      const holiday = holidayResolver.match(text, kb, ctx)
      if (holiday?.resolvedDate) {
        const candidate = firstOfMonth(holiday.resolvedDate) >= holiday.resolvedDate
          ? firstOfMonth(holiday.resolvedDate) : firstOfNextMonth(holiday.resolvedDate)
        return {
          referenceType: 'composite', priorityLevel: 2,
          resolvedDate: candidate, resolvedTime: null, calendarType: 'gregorian', confidence: 'medium',
          requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: true,
          needsClarification: false, clarificationReason: null,
          matchedRule: 'composite:month_start_after_holiday',
          dataSourcesUsed: ['temporal_holidays'], dataSourcesAvailableButUnused: [],
          confidenceReason: 'أول الشهر الذي يقع بعد انتهاء العطلة المذكورة',
        }
      }
    }

    // ── "بعد أسبوعين إذا نزل الراتب" — explicit numeric offset, conditioned
    //    on salary. The explicit number is the firmer signal; the salary
    //    mention is recorded as a dependency, not allowed to override it.
    if (/(اذا|لو)\s*(نزل|دخل)?\s*الراتب/.test(text)) {
      const m = text.match(/(?:بعد|خلال)\s*(\d+)?\s*(اسبوعين|اسبوع|يوم|يومين)/)
      if (m) {
        const offsetDays = parseOffsetDays(m[0]) ?? parseOffsetDays(text)
        if (offsetDays) {
          return {
            referenceType: 'composite', priorityLevel: 2,
            resolvedDate: addDaysToDateString(todayStr, offsetDays), resolvedTime: null,
            calendarType: 'gregorian', confidence: 'medium',
            requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
            needsClarification: false, clarificationReason: null,
            matchedRule: 'composite:explicit_offset_conditional_on_salary',
            dataSourcesUsed: ['message_timestamp'], dataSourcesAvailableButUnused: ['customers.metadata.salary_day'],
            confidenceReason: 'العميل ذكر فترة محدّدة بالأيام، مع ربطها بشرط نزول الراتب — التاريخ محسوب من الفترة الصريحة',
          }
        }
      }
    }

    return null
  },
}
