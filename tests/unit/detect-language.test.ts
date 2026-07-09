import { describe, it, expect } from 'vitest'
import { isNonArabicText, isNonArabicConversation } from '@/lib/detect-language'

describe('isNonArabicText', () => {
  it('flags short English messages with zero Arabic script ("Hi", "Ok", "no")', () => {
    expect(isNonArabicText('Hi')).toBe(true)
    expect(isNonArabicText('Ok')).toBe(true)
    expect(isNonArabicText('no')).toBe(true)
  })

  it('does not flag Arabic text', () => {
    expect(isNonArabicText('مرحبا كيف الحال')).toBe(false)
  })

  it('does not flag emoji/number-only text with no letters at all', () => {
    expect(isNonArabicText('👍👍👍')).toBe(false)
    expect(isNonArabicText('12345')).toBe(false)
  })
})

describe('isNonArabicConversation', () => {
  it('is true for a conversation that is entirely English — real incident, customer RAYMOND LASTRELLA BLANCAFLOR / 4a47f571', () => {
    const texts = [
      'Better I check with Mobily office tomorrow morning',
      'Can you check the phone number of this bill? Please',
      'I want to pay in installments',
      'Ok',
    ]
    expect(isNonArabicConversation(texts)).toBe(true)
  })

  it('is false for a genuinely Arabic conversation', () => {
    expect(isNonArabicConversation(['وش الوضع', 'ابغى اتأكد من المبلغ'])).toBe(false)
  })

  it('is false (defaults to Arabic) when there is no judgeable text at all', () => {
    expect(isNonArabicConversation([])).toBe(false)
    expect(isNonArabicConversation(['📎', '👍', ''])).toBe(false)
  })

  it('does not flip to English from a single stray Arabic word in an otherwise English conversation, and vice versa', () => {
    expect(isNonArabicConversation(['Hi', 'thanks', 'ok', 'مرحبا'])).toBe(true)
    expect(isNonArabicConversation(['مرحبا', 'شكرا', 'تمام', 'hi'])).toBe(false)
  })
})
