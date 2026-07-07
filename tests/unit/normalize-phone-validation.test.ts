import { describe, it, expect } from 'vitest'
import { normalizePhone } from '@/lib/whatsapp'

// Real production bug (2026-07-08): normalizePhone's fallback returned the
// raw digits UNCHANGED for any input that didn't match a known Saudi mobile
// shape — silently treating garbage as a valid number. Confirmed live: an
// Excel "contact numbers" cell containing "172228020" (not a valid Saudi
// mobile shape at all) was accepted and stored as a real customer's phone/
// whatsapp number during import. Every call site chains this with `||` to
// fall back to null on invalid input — that only works if invalid input
// actually returns falsy ('') instead of masking garbage as real.
describe('normalizePhone — real Saudi mobile shapes are normalized, everything else is rejected', () => {
  it('normalizes a local 05XXXXXXXX number', () => {
    expect(normalizePhone('0501234567')).toBe('966501234567')
  })

  it('normalizes a bare 5XXXXXXXX number with no prefix', () => {
    expect(normalizePhone('501234567')).toBe('966501234567')
  })

  it('leaves an already-normalized 966-prefixed number unchanged', () => {
    expect(normalizePhone('966501234567')).toBe('966501234567')
  })

  it('normalizes E.164 (+966...) and strips separators', () => {
    expect(normalizePhone('+966-50 123-4567')).toBe('966501234567')
  })

  it('rejects a number that does not match any real Saudi mobile shape — the exact real incident (9-digit "172228020")', () => {
    expect(normalizePhone('172228020')).toBe('')
  })

  it('rejects a 10-digit number starting with 0 that is not a mobile (e.g. a landline-shaped 01XXXXXXXX)', () => {
    expect(normalizePhone('0112345678')).toBe('')
  })

  it('rejects a 966-prefixed number whose local part is not a real mobile prefix', () => {
    expect(normalizePhone('966112345678')).toBe('')
  })

  it('rejects empty/garbage input', () => {
    expect(normalizePhone('')).toBe('')
    expect(normalizePhone('abc')).toBe('')
  })
})
