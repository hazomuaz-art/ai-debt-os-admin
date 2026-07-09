// Shared Arabic/non-Arabic script detector. Any letters at all with ZERO
// Arabic script present is a certain non-Arabic verdict regardless of
// length ("Hi", "ok", "no" all qualify); the 30% ratio threshold only
// matters for judging a mixed-script message. Mirrors the per-message logic
// in ai-collector-agent.ts's isNonArabicMessage signal.
export function isNonArabicText(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '')
  if (!letters.length) return false
  const arabicLetters = (text.match(/[؀-ۿݐ-ݿࢠ-ࣿ]/g) ?? []).length
  if (arabicLetters === 0) return true
  return arabicLetters / letters.length < 0.3
}

// Real production bug this fixes (customer RAYMOND LASTRELLA BLANCAFLOR /
// 4a47f571, 2026-07-09): the main collector agent already mirrors a
// customer's language per-message, but the document-classification ack path
// is a separate code path that never looked at the conversation's language
// at all — it always replied in Arabic, even to a customer whose entire
// conversation (dozens of turns) was in English. A single caption-less
// attachment (the common case) has no text of its own to judge, so this
// looks at the customer's RECENT REAL messages instead of just the current
// one. Majority vote across the sample, not "any one Arabic message flips
// it back" — a customer who occasionally types an Arabic word/phrase mid
// English conversation shouldn't bounce the whole conversation back to
// Arabic for one attachment ack.
export function isNonArabicConversation(recentInboundTexts: string[]): boolean {
  const judged = recentInboundTexts.map(t => t.trim()).filter(t => /\p{L}/u.test(t))
  if (!judged.length) return false
  const nonArabicCount = judged.filter(isNonArabicText).length
  return nonArabicCount / judged.length > 0.5
}
