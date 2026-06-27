import type { TemporalKnowledgeBase } from './types'

// KB-driven normalization — replaces hardcoded spelling lists. Hamza
// collapsing and word-final ه→ة are still the two structural rules (they
// generalize automatically to ANY word), the KB only adds explicit
// word-for-word variants for cases the structural rules don't cover.
export function normalizeTemporalText(raw: string, kb: TemporalKnowledgeBase): string {
  let t = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    // Word-final ه→ة, EXCEPT "الله" (Allah) and its bound forms (بالله,
    // تالله, لله...) — an extremely common word that must never be mangled
    // into "الة". This is the exact false-positive risk flagged in the
    // architecture review; "الله" is the one real-world collision found.
    .replace(/(^|\s)(ب|ت|ل)?الله(?=\s|$)/g, '$1$2الله__PROTECTED__')
    .replace(/ه(?=\s|$)/g, 'ة')
    .replace(/الله__PROTECTED__/g, 'الله')

  for (const v of kb.spellingVariants) {
    // Variant words are stored in their natural form; normalize them the
    // same structural way before substitution so "بدايه" (already partially
    // normalized to "بداية" by the rule above) still matches.
    const normalizedVariant = v.variant.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ه(?=\s|$)/g, 'ة')
    const normalizedCanonical = v.canonical.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ه(?=\s|$)/g, 'ة')
    if (normalizedVariant !== normalizedCanonical) {
      t = t.split(normalizedVariant).join(normalizedCanonical)
    }
  }
  return t
}

export function toAsciiDigits(s: string): string {
  return String(s ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
}
