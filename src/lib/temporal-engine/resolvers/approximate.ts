import type { ResolverMatch, TemporalResolver } from '../types'

// Known-approximate expressions — intentionally NEVER resolve to a date.
// This is the only resolver allowed to deliberately produce resolved:false
// for a recognized pattern (as opposed to "unrecognized", which is a
// genuinely different outcome — see the Learning Capture layer).
// NOTE: these are checked AFTER normalizeTemporalText() has already run
// (hamza أ/إ/آ → ا), so only the hamza-free forms ever match — listing a
// hamza variant here would be dead code, never reached.
const APPROXIMATE_PHRASES = [
  'قريب', 'قريباً', 'اذا تيسرت', 'اذا الله سهل',
  'ان شاء الله', 'باذن الله', 'بعدين', 'لاحقاً', 'لاحقا',
]

export const approximateResolver: TemporalResolver = {
  type: 'approximate',
  priorityLevel: 8,
  match(text: string): ResolverMatch | null {
    if (!APPROXIMATE_PHRASES.some(p => text.includes(p))) return null
    return {
      referenceType: 'approximate', priorityLevel: 8,
      resolvedDate: null, resolvedTime: null, calendarType: 'gregorian', confidence: null,
      requiresCustomerData: false, requiresCompanyPolicy: false, requiresCalendar: false,
      needsClarification: true, clarificationReason: 'no_real_temporal_reference',
      matchedRule: 'approximate:known_vague_phrase',
      dataSourcesUsed: [], dataSourcesAvailableButUnused: [],
      confidenceReason: 'تعبير تقريبي معروف بلا أي مرجع زمني حقيقي قابل للتحويل',
    }
  },
}
