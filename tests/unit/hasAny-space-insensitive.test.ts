import { describe, it, expect } from 'vitest'
import { detectSignals } from '@/lib/ai-collector-agent'

// Full-system audit finding: every multi-word Arabic keyword phrase
// required the exact spacing of that phrase, but Saudi WhatsApp users
// extremely commonly drop the space right after "ما" — a high-frequency
// real typing pattern, not an edge case. Fixed once in hasAny() for all 33
// call sites at once (every signal), verified here across several signals.
describe('detectSignals — space-dropped Arabic phrases ("مارح" instead of "ما راح")', () => {
  it('refusesToPay still fires when the space after ما is dropped', () => {
    expect(detectSignals('ماراح اسدد ابد').refusesToPay).toBe(true)
  })

  it('deniesDebt still fires when the space after ما is dropped', () => {
    expect(detectSignals('مافي مديونية علي').deniesDebt).toBe(true)
  })

  it('deniesPromise now covers any conjugation of اتفق via the verb stem, not just اتفقنا', () => {
    expect(detectSignals('انا ما اتفقت معك على شي').deniesPromise).toBe(true)
    expect(detectSignals('احنا ما اتفقنا على شي').deniesPromise).toBe(true)
  })

  it('still matches the normal spaced phrasing (no regression)', () => {
    expect(detectSignals('ما راح اسدد ابد').refusesToPay).toBe(true)
  })
})
