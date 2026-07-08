import { describe, it, expect } from 'vitest'
import { detectSignals } from '@/lib/ai-collector-agent'

// Some debtors (recruitment/agriculture portfolios especially) are expat
// workers who don't read Arabic — forcing the mandatory Saudi-dialect rule
// on them is useless. This signal must correctly tell Arabic from non-Arabic
// customer messages so the system prompt can mirror the customer's language
// instead.
describe('detectSignals — isNonArabicMessage', () => {
  it('detects a clearly Arabic message as Arabic', () => {
    expect(detectSignals('والله ما اقدر اسدد هذا الشهر').isNonArabicMessage).toBe(false)
  })

  it('detects a clearly English message as non-Arabic', () => {
    expect(detectSignals('I cannot pay this amount right now, please give me more time').isNonArabicMessage).toBe(true)
  })

  it('detects Urdu (Arabic-script Perso-Arabic letters used by Urdu) text correctly as non-Arabic-dialect-eligible script overlap is acceptable, but plain Latin-script Urdu/Hindi romanization is non-Arabic', () => {
    expect(detectSignals('mujhe abhi paisa nahi hai, thori mohlat de dein').isNonArabicMessage).toBe(true)
  })

  it('does not misfire on a short reply with no real letters (numbers/emoji only)', () => {
    expect(detectSignals('12345').isNonArabicMessage).toBe(false)
    expect(detectSignals('👍').isNonArabicMessage).toBe(false)
  })

  it('does not misfire on a short Arabic acknowledgement', () => {
    expect(detectSignals('تمام').isNonArabicMessage).toBe(false)
  })

  // Real production bug (customer RAYMOND LASTRELLA BLANCAFLOR, 2026-07-08):
  // opened with "Hi" and got a full Arabic reply back — the old length-floor
  // (letters.length < 3) treated any short message as unjudgeable, silently
  // defaulting to Arabic even though "Hi" has zero Arabic characters at all.
  it('detects a short English greeting with zero Arabic characters as non-Arabic (the real incident)', () => {
    expect(detectSignals('Hi').isNonArabicMessage).toBe(true)
    expect(detectSignals('ok').isNonArabicMessage).toBe(true)
    expect(detectSignals('no').isNonArabicMessage).toBe(true)
  })
})
