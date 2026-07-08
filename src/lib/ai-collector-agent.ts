import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import {
  buildCustomer360Context,
  isDebtRelatedMessage,
  selectDebtGroup,
  pickPrimaryDebt,
  mapDebtForList,
} from '@/lib/customer-context-engine'
import { getPlaybookForPortfolio, renderPlaybookForPrompt } from '@/lib/company-playbook'
import { classifyInsuranceCase, detectInsuranceObjectionSignals, renderInsuranceCaseFile } from '@/lib/insurance-engine'
import { detectMandatoryEscalation, getOpenEscalation, openEscalation, renderLegalPersonaReply, renderRepeatedRefusalNotice, detectStcReviewSignal, recordStcReview, trackRefusalForLegalEscalation, generateLawyerPersonaReply, REFUSAL_THRESHOLD } from '@/lib/legal-escalation'
import { COMPANY_IMPORT_PROFILES } from '@/lib/company-import-profiles'
import { renderStcKnowledgeForCaseFile, detectStcFieldMeaningQuestion } from '@/lib/stc-knowledge'
import { renderMobilyKnowledgeForCaseFile, detectMobilyFieldMeaningQuestion, resolveMobilyPaymentNumber } from '@/lib/mobily-knowledge'
import {
  detectSevereDistress, renderDistressReply,
  detectOptOutIntent, renderOptOutConfirmation, setContactOptOut,
  getCustomerGateState, extractLast4Candidate, nationalIdLast4,
  recordVerificationAttempt, markVerified, incrementFailedVerification,
  raiseUrgentHumanAlert, isSafePreVerificationIntent, MAX_VERIFICATION_ATTEMPTS,
  setPendingClarification, clearPendingClarification,
} from '@/lib/conversation-gates'
import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai-collector-agent')

export type CollectorDecision = {
  shouldReply: boolean
  action:
    | 'reply'
    | 'silent'
    | 'request_proof'
    | 'request_clarification'
    | 'negotiate'
    | 'pressure'
    | 'close_conversation'
    | 'record_installment_request'
    | 'record_promise'
    | 'record_dispute'
    | 'record_wrong_number'
    | 'human_review'
  reason: string
  message: string
  // Only meaningful when action === 'record_promise' — the exact date
  // (YYYY-MM-DD) the customer stated, extracted by the model itself using
  // the real "today" given in the prompt. Never fabricated downstream.
  promised_date?: string | null
  // The customer's stated timing in their OWN words / meaning, exactly as they
  // expressed it (e.g. "مع نزول الراتب", "بداية الشهر الجاي", "عند نزول حساب
  // المواطن", "بكرا"). This is the semantic promise — stored and reused so the
  // agent never re-asks. Set by the model for any timing expression, however
  // phrased; we do NOT keyword-match it.
  promise_text?: string | null
  // Only meaningful when action === 'record_promise'. Real gap this fixes:
  // the system used to ALWAYS record the promise as if the customer
  // committed to the full current_balance, even when they explicitly
  // committed to a smaller amount (e.g. "بسدد 200 الشهر" while the balance
  // is 789) — there was no way to distinguish "customer promised the FULL
  // balance" from "customer promised only part of it" anywhere in the
  // system. If the customer's own words specify a SPECIFIC amount smaller
  // than the full balance, the model extracts it here; otherwise leave
  // null and the full current_balance is used (unchanged default).
  promised_partial_amount?: number | null
  // Only meaningful when action === 'record_dispute'. Real root-cause fix
  // (2026-07-07): whether a dispute was "specific enough to act on" used to
  // be decided by matching the customer's CURRENT message against a fixed
  // keyword list (hasSpecificDisputeReason) — inherently unable to recognize
  // any phrasing not already enumerated (confirmed live: "لا يوجد عندي
  // شرائح أو تعامل مع موبايلي سابقاً" wasn't on the list, so the model was
  // told the customer gave no reason when they clearly had, and it asked a
  // generic clarifying question instead of answering what was actually
  // said). Growing that list forever doesn't fix the underlying problem —
  // any new phrasing keeps slipping through, and a coincidental keyword
  // match on unrelated text can just as easily misfire the other way. This
  // replaces the keyword guess with the model's OWN read of the message:
  // quote/summarize, in the customer's words, the actual reason they gave —
  // or leave this null if they only expressed vague doubt/uncertainty with
  // no real content ("ما اتذكر", "يمكن غلط" and nothing else). The code
  // checks whether this field is populated, not what words appear in it.
  dispute_reason?: string | null
  // Real root-cause fix (2026-07-08): whether the customer PERSONALLY
  // invoked a lawyer/court/complaint used to be decided by a pre-model
  // keyword scan on the raw text ("محامي"/"محكمة"/etc) — it couldn't tell a
  // genuine personal threat from the customer quoting/forwarding our OWN
  // outbound SMS notice back to us (confirmed live: a customer pasted our
  // own reminder SMS, which itself mentions "المحامي", and got treated as
  // if they personally threatened us). The model now reads the full message
  // and reports its own semantic verdict here — null unless the customer
  // truly, personally invoked this in their own current words (see §14).
  legal_escalation_trigger?: 'lawyer_mention' | 'legal_threat' | 'complaint' | null
  // The debt id the agent ACTUALLY reasoned about internally (via
  // forcedDebtId resolution, which can differ from the caller-supplied
  // args.debt_id for multi-portfolio customers). Callers must use THIS for
  // any side-effect write (promise/dispute/installment-request), never the
  // id they originally passed in — otherwise the record can attach to the
  // wrong debt.
  resolvedDebtId?: string | null
}

type HistoryItem = {
  direction: string
  content: string
}

// ════════════════════════════════════════════════════════════════════
//  Helpers
// ════════════════════════════════════════════════════════════════════

function norm(text: string) {
  return String(text ?? '').trim().toLowerCase()
}

// Real production gap found in a full-system audit: every multi-word
// Arabic keyword phrase (e.g. "ما اتفقنا", "ما راح اسدد") required the
// EXACT spacing of that phrase. Saudi WhatsApp users extremely commonly
// drop the space right after "ما" ("مارح اسدد", "ماقدر", "مابي") — a real,
// high-frequency typing pattern, not an edge case — which silently failed
// every single one of the 33 hasAny() call sites across every signal
// (refusesToPay, deniesPromise, deniesDebt, dispute, etc.) for any message
// typed that way. Fixed once, here, for all of them at once: falls back to
// a space-stripped comparison only when the normal spaced match misses.
function hasAny(text: string, words: string[]) {
  const v = norm(text)
  if (words.some(w => v.includes(w.toLowerCase()))) return true
  const vCompact = v.replace(/\s+/g, '')
  return words.some(w => vCompact.includes(w.toLowerCase().replace(/\s+/g, '')))
}

// A customer DENYING they ever raised/are raising a dispute ("ما اعترضت",
// "مو معترض", "ليش تقول اعتراض؟") must never be treated the same as them
// actually declaring one — a bare substring match on 'اعتراض'/'معترض' can't
// tell the two apart. Real production regression this fixes: the agent kept
// confronting a customer who explicitly denied disputing with "our file
// shows you objected before" — negation-blind keyword matching treated the
// customer's OWN denial as if it were a fresh dispute declaration. Checks
// for a negation particle in the few words immediately before the match.
function isNegatedMatch(text: string, keyword: string): boolean {
  const v = norm(text)
  const idx = v.indexOf(keyword.toLowerCase())
  if (idx === -1) return false
  const before = v.slice(Math.max(0, idx - 12), idx)
  return /(^|\s)(ما|لا|مو|مب|مانيش|ماني|ولا|مش)(\s|$)/.test(before)
}

function hasAnyUnnegated(text: string, words: string[]): boolean {
  const v = norm(text)
  return words.some(w => v.includes(w.toLowerCase()) && !isNegatedMatch(text, w))
}

// Convert Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) numerals to ASCII
// so that `\d` and numeric date parsing actually work on real WhatsApp text
// like "يوم ٣٠" or "٣٠-٠٦". Without this, every Arabic-numeral date was treated
// as "no date" — the core reason valid promises were rejected and re-asked.
function toAsciiDigits(s: string): string {
  return String(s ?? '')
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0))
}

// Broad, robust detection of an explicit pay date/time the customer stated,
// covering the many real spellings used on WhatsApp: بكرا/بكره/بكرة, غدا/غداً,
// اليوم, weekday names, نهاية/آخر الشهر, مع الراتب, numeric dates (30/6, يوم 30,
// 30 الشهر), and "خلال/بعد N يوم/اسبوع/شهر". Arabic numerals are normalised
// first. This REPLACES a narrow keyword list that missed "بكرا" and every
// Arabic-numeral date, which is what caused the post-promise questioning loop.
// "الحين"/"اليوم" alone are NOT reliable payment-timing signals — they're
// extremely common general-purpose words ("now"/"today") in Saudi dialect
// that show up in totally unrelated sentences ("الحين اراجع موبايلي ولا
// وين؟", "ما ابغي اسدد الحين"). A real production incident: the agent
// fabricated brand-new promises (with a wrong/drifting date) from plain
// questions and refusals that merely happened to contain "الحين". They only
// count as a temporal reference when paired with an actual payment-commitment
// verb in the SAME message — otherwise they're noise.
const PAYMENT_VERB = /(سدد|اسدد|أسدد|بسدد|ادفع|أدفع|بدفع|احول|أحول|بحول|حول|دفعت|سددت|حولت)/
// Real production bug this fixes: unlike the "اليوم/الحين" branch below (which
// correctly requires PAYMENT_VERB alongside it), the salary/pension branch
// matched on the bare word "راتب" alone with no such guard — so a hardship
// statement like "راتبي ما يكفي اني اسدد" (my salary ISN'T ENOUGH for me to
// pay) got treated as a temporal payment reference purely because it
// contains "راتب", forcing a fabricated promise (with an invented date) from
// a message that was actually a refusal. "أسدد براتبي"/"بعد الراتب" (a real
// commitment tied to salary) is unaffected — only the insufficiency framing
// is excluded.
const SALARY_INSUFFICIENT_RE = /(ما\s*يكفي|ما\s*يكفيني|ما\s*يوصل|مو\s*كافي|مب\s*كافي|ناقص|قليل)/
function hasTemporalRef(raw: string): boolean {
  const t = toAsciiDigits(norm(raw))
  return (
    /(بكرا|بكره|بكرة|غدا|غدًا|غداً|بعد بكر|بعد غد|عقب بكر)/.test(t) ||
    (/(اليوم|الحين)/.test(t) && PAYMENT_VERB.test(t)) ||
    /(السبت|الاحد|الأحد|الاثنين|الإثنين|الثلاثاء|الاربعاء|الأربعاء|الخميس|الجمعه|الجمعة)/.test(t) ||
    (/(الراتب|راتب|معاش)/.test(t) && !SALARY_INSUFFICIENT_RE.test(t)) ||
    // Government support program payouts — customers commonly tie a promise
    // to these instead of a calendar date (e.g. "بسدد مع حساب المواطن").
    /(حساب المواطن|المواطن|الضمان الاجتماعي|الضمان|ساند|حافز|التامينات|التأمينات|التقاعد)/.test(t) ||
    /(نهاية|اخر|آخر|بداية|اول|أول|منتصف)\s*(الشهر|الاسبوع|الأسبوع)/.test(t) ||
    /(نهاية الشهر|اخر الشهر|آخر الشهر|الشهر الجاي|الشهر القادم|الاسبوع الجاي|الأسبوع الجاي|هالاسبوع|هالشهر)/.test(t) ||
    /\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\b/.test(t) ||
    /يوم\s*\d{1,2}/.test(t) ||
    /\b\d{1,2}\s*(الشهر|من الشهر|بالشهر|شهر)\b/.test(t) ||
    /(خلال|بعد|عقب|كل)\s*\d+\s*(يوم|ايام|أيام|اسبوع|أسبوع|اسابيع|أسابيع|شهر|شهور|اشهر|أشهر)/.test(t)
  )
}

// Payment-commitment verbs — used to decide when it's worth consulting the
// Temporal Intelligence Engine even though the simple lexicon (hasTemporalRef)
// didn't already flag the message as a promise (e.g. "بسدد بعد العيد" — a
// clear holiday reference, just outside hasTemporalRef's word list).
const COMMITMENT_VERBS = ['أسدد', 'اسدد', 'بسدد', 'أحول', 'احول', 'بحول', 'بدفع', 'ادفع', 'أدفع']

// Only unambiguous farewell/thanks phrases — short acks like "طيب" or "تمام"
// are often mid-negotiation responses expecting a follow-up push, not an
// end of conversation, so they're deliberately NOT treated as closers here.
function isCloser(text: string) {
  return /^(يعطيك العافية|شكرا|شكراً|thanks|thank you)$/i.test(text.trim())
}

function isGreeting(text: string) {
  const normalized = text.trim().toLowerCase()
  const greetingRegex = /^(السلام|سلام|هلا|مرحبا|هاي|hi|hello|مساء|صباح|يسعد|يا هلا|أهلين|اهلين|كيف|شلونك|اخبارك|كيفك).*/i
  const businessRegex = /(سدد|رقم|مبلغ|ريال|فاتورة|اقساط|قسط|راتب|تحويل|خصم|بنك|رسالة|شركة|مديونية|دين|حساب|أدفع|ادفع|فلوس|صعب|ظروف)/i
  return greetingRegex.test(normalized) && normalized.length <= 40 && !businessRegex.test(normalized)
}

function cleanReply(reply: string, customerFirstName?: string, isFirstMessage?: boolean) {
  let r = String(reply ?? '')
    .replace(/أخوي[،,\s]*/g, '')
    .replace(/عزيزي العميل[،,\s]*/g, '')
    .replace(/عميلنا العزيز[،,\s]*/g, '')
    .trim()

  // Deterministic safety net: the model is told not to address the customer
  // by name as a habit after the first message, but LLMs don't always obey
  // that instruction — so strip a leading vocative name ourselves rather
  // than relying on the prompt alone. Only strips it at the START of the
  // reply (a habitual greeting-style use), so a legitimate mid-sentence
  // answer to "ايش اسمي" is left untouched.
  if (!isFirstMessage && customerFirstName) {
    const esc = customerFirstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    r = r.replace(new RegExp(`^(يا\\s+)?${esc}[،,]?\\s*`, 'i'), '').trim()
  }
  return r
}

const ARABIC_WORD_NUM: Record<string, number> = {
  'يوم': 1, 'يومين': 2, 'اسبوع': 7, 'أسبوع': 7, 'اسبوعين': 14, 'أسبوعين': 14,
  'شهر': 30, 'شهرين': 60, 'شهر ونص': 45, 'شهر و نص': 45,
  'ثلاث شهور': 90, 'تلات شهور': 90, '3 شهور': 90, 'ثلاثة اشهر': 90,
}

// Best-effort detection of a grace period the customer is asking for, in
// days — used to deterministically stop the model from agreeing to
// anything beyond the policy max (30 days), since it doesn't reliably
// follow that instruction from prompt text alone.
function detectRequestedGraceDays(text: string): number | null {
  const t = toAsciiDigits(norm(text))
  for (const [phrase, days] of Object.entries(ARABIC_WORD_NUM)) {
    if (t.includes(phrase)) return days
  }
  const numMonth = t.match(/(\d+)\s*شهر/)
  if (numMonth) return parseInt(numMonth[1]) * 30
  const numWeek = t.match(/(\d+)\s*اسبوع|(\d+)\s*أسبوع/)
  if (numWeek) return parseInt(numWeek[1] || numWeek[2]) * 7
  const numDay = t.match(/(\d+)\s*يوم/)
  if (numDay) return parseInt(numDay[1])
  return null
}

function hasExplicitDisputeDeclaration(text: string): boolean {
  // 'اعتراض'/'معترض'/'نزاع'/'متنازع' specifically must be negation-checked —
  // "ما اعترضت" or "مو معترض" is the OPPOSITE of a declaration. The other
  // phrases below ("ما اوافق على المبلغ", "ما عندي مديونية", ...) are
  // themselves already negation-shaped statements of the dispute itself, so
  // they're intentionally left on the plain hasAny check.
  return hasAnyUnnegated(text, ['معترض', 'اعتراض', 'متنازع', 'نزاع', 'dispute', 'i object']) || hasAny(text, [
    'ما اوافق على المبلغ', 'ما أوافق على المبلغ',
    'مو موافق على المبلغ', 'لا اوافق', 'لا أوافق', 'مو راضي عن المبلغ', 'مرفوض المبلغ',
    'هذا مو حسابي', 'مو حسابي', 'الحساب مو لي', 'ما عندي مديونية', 'ما علي مديونية',
  ])
}

export function detectSignals(text: string) {
  return {
    paymentClaim: hasAny(text, ['سددت', 'دفعت', 'حولت', 'ايصال', 'إيصال', 'paid', 'receipt', 'transfer']),
    // Narrowed twice: (1) 'ما اعرف'/'ما أعرف' ("I don't know") removed
    // entirely — it means "I don't know [when/whether/...]" in the vast
    // majority of real messages (e.g. "ما اعرف متى بقدر اسدد" is a
    // NEGOTIATION reply, not a dispute) and was firing false-positive DISPUTE
    // routing on totally unrelated replies. (2) the dispute-declaring words
    // are now negation-checked — "ما اعتراض عندي" must not match the same as
    // "عندي اعتراض".
    dispute: hasAnyUnnegated(text, ['غلط', 'اعتراض', 'مو صحيح', 'not mine', 'wrong amount']),
    installment: hasAny(text, ['تقسيط', 'اقساط', 'أقساط', 'installment', 'installments']),
    promise: hasAny(text, ['بسدد', 'اسدد', 'بسددها', 'نهاية الشهر', 'بكرة', 'بكره', 'الخميس', 'الراتب', 'salary', 'tomorrow']),
    hardship: hasAny(text, ['ما عندي', 'ظروف', 'فلوس', 'راتب', 'متعسر', 'ما اقدر', 'ما أقدر']),
    angry: hasAny(text, ['ازعاج', 'ازعجتونا', 'شكوى', 'محامي', 'بلاغ', 'court', 'lawyer', 'complaint']),
    wrongNumber: hasAny(text, ['الرقم غلط', 'ما يخصني', 'مو رقمي', 'wrong number']),
    // Explicit denial that any debt exists at all — distinct from a paymentClaim
    // (paid already) or a specific dispute reason (wrong amount/not mine for a
    // KNOWN reason). This is a bare denial and must be treated as an inquiry to
    // investigate, never as a promise to pay or an introduction to push past.
    deniesDebt: hasAny(text, [
      'ما عندي مديونية', 'ما علي مديونية', 'ما عندي دين', 'ما علي دين', 'مالي مديونية',
      'ليس علي مديونية', 'ليس عندي مديونية', 'ليس علي دين', 'ليس عندي دين',
      'مافي مديونية', 'ما عليه شي', 'هذا مو حساب', 'مو حسابي', 'الحساب مو لي',
      'لا اعرف هذا الدين', 'لا أعرف هذا الدين', 'ما اعرف هذا الدين', 'ما أعرف هذا الدين',
      "don't have a debt", 'no debt',
    ]),
    // Direct identity/company/detail requests — must be answered FROM the case
    // file (never deflected to "أرجع للإدارة") whenever the data exists.
    asksWhoAreYou: hasAny(text, [
      'من انت', 'من أنت', 'مين انت', 'مين أنت', 'منت', 'وش انت', 'مين المتصل', 'مين يتكلم', 'who are you',
      'اسمك', 'من معي', 'مين معي',
    ]),
    // The customer explicitly denies having made any promise at all ("ما
    // وعدتك بشي") — distinct from deniesDebt (denying the debt itself). The
    // agent must NEVER restate/confirm the existing promise in this case.
    // Real production gap: a customer said "ما اتفقت معك على شي" (different
    // conjugation of "اتفقنا" the list didn't cover) and it never matched,
    // so the resulting "broken promise" never got recorded anywhere either.
    deniesPromise: hasAny(text, [
      'ما وعدتك', 'مو وعدتك', 'ماوعدتك', 'انا ما وعدت', 'أنا ما وعدت', 'لم اعدك', 'لم أعدك',
      'ما قلت لك بسدد', 'ما قلت بسدد', 'مين قال', 'وين قلت',
      // 'ما اتفق' (the verb stem alone, not a specific conjugation like
      // 'اتفقنا') is a substring match (see hasAny below), so it covers
      // 'ما اتفقنا'/'ما اتفقت'/'ما اتفقتوا'/etc in one entry — this is what
      // the original "ما اتفقنا"-only version should have been from the
      // start instead of needing a second near-duplicate entry per
      // conjugation found one at a time in production.
      'ما اتفق', 'متى وعدتك', 'وعدتك متى',
    ]),
    // Explicit refusal to pay (distinct from deniesDebt — customer here does
    // NOT dispute the debt exists, they're simply refusing/unwilling, or
    // demanding contact stop, or escalating to legal/court). Root cause of a
    // real production incident: with no signal for this, the model kept
    // re-asking "متى تقدر تسدد؟" after the customer refused outright multiple
    // times — never escalating, never changing approach.
    refusesToPay: hasAny(text, [
      'ما ابغي اسدد', 'ما أبغي اسدد', 'لن اسدد', 'لن أسدد', 'ما ابغى اسدد',
      'ما اقدر اسدد', 'ما أقدر اسدد', 'ما راح اسدد', 'ما راح أسدد',
      'لا ترسلون لي', 'لا ترسلوا لي', 'ما عاد تتواصلون معي', 'ما عاد تتصلون',
      'ارفعوها للمحكمة', 'ارفعوها للمحكمه', 'ارفعها للمحكمة', 'ارفعها للمحكمه',
      'محكمة', 'المحكمه', 'هرفع شكوى', 'برفع شكوى', 'بشتكي عليكم',
    ]),
    asksCompany: hasAny(text, [
      'وش الشركة', 'ايش الشركة', 'إيش الشركة', 'مين الشركة', 'اي شركة', 'أي شركة',
      'لمين هذا', 'لصالح مين', 'لحساب مين', 'مين الجهة', 'وش الجهة', 'ايش الجهة',
    ]),
    asksDetails: hasAny(text, [
      'عطني التفاصيل', 'أعطني التفاصيل', 'اعطني التفاصيل', 'عطني تفاصيل', 'وضح لي',
      'التفاصيل', 'تفاصيل أكثر', 'تفاصيل المديونية', 'وش التفاصيل', 'ايش التفاصيل', 'إيش التفاصيل',
    ]),
    // §7: the ONLY trigger that may surface original_amount — everywhere
    // else the model only ever sees current_balance (amountDue).
    asksWhyAmountChanged: hasAny(text, [
      'ليش المبلغ تغير', 'ليش المبلغ تغيّر', 'ليه المبلغ تغير', 'ليش زاد المبلغ', 'ليش زاد',
      'ليش المبلغ زاد', 'وش سبب زيادة المبلغ', 'المبلغ مختلف عن الأول', 'المبلغ يختلف عن السابق',
      'why did the amount change', 'why is the amount different',
    ]),
    // Some debtors (recruitment/agriculture portfolios especially) are
    // expat workers who don't read Arabic at all — forcing the mandatory
    // Saudi-dialect-only rule on them is actively useless. A message with
    // essentially no Arabic script in it is the signal to drop that rule
    // for this reply and mirror whatever language the customer actually
    // used instead. A numbers/emoji-only reply has no script either way, so
    // it's excluded (letters.length === 0).
    //
    // 🔴 Real bug found live (customer RAYMOND LASTRELLA BLANCAFLOR,
    // 2026-07-08): opened the conversation with "Hi" (2 letters) and got a
    // full Arabic reply — the OLD `letters.length < 3` floor treated any
    // short message as "not enough signal", silently defaulting to Arabic
    // even though "Hi" is unambiguously English with zero Arabic characters.
    // Any letters at all with ZERO Arabic script present is already a
    // certain non-Arabic verdict regardless of length ("Hi", "ok", "no" all
    // qualify) — the ratio-based 30% threshold is only needed to judge a
    // MIXED-script message, where a length floor still isn't the right tool.
    isNonArabicMessage: (() => {
      const letters = text.replace(/[^\p{L}]/gu, '')
      if (!letters.length) return false
      const arabicLetters = (text.match(/[؀-ۿݐ-ݿࢠ-ࣿ]/g) ?? []).length
      if (arabicLetters === 0) return true
      return arabicLetters / letters.length < 0.3
    })(),
  }
}

// Single shared definition (was previously duplicated/reinvented at three
// separate call sites with slightly different regexes) of: "did the
// customer's CURRENT message actually ask/request something?" Every guard
// in this file that might substitute a canned "your promise is recorded"
// line MUST check this first and never bury a real question — root cause of
// multiple confirmed production bugs ("ايش المنتج؟", "اي طلب؟", "وعد ايش؟" all
// answered with a bare promise-confirmation that ignored the actual question).
function customerAskedSomething(text: string, signals: ReturnType<typeof detectSignals>): boolean {
  const askedQ = /[؟?]/.test(text) || /(متى|كم|وش|ايش|إيش|مين|ليش|ليه|هل|أي\s|اي\s|كيف)/.test(text)
  return askedQ || signals.asksDetails || signals.asksCompany || signals.asksWhoAreYou || signals.asksWhyAmountChanged
}

function isRobotic(reply: string) {
  return hasAny(reply, [
    'أنا هنا للمساعدة',
    'كيف أقدر أساعدك',
    'كيف أقدر أخدمك',
    'إذا عندك أي استفسار',
    'شكراً لتواصلك',
    'عميلنا العزيز',
    'عزيزي العميل',
    'يرجى التكرم',
    'نود إشعاركم',
    'نفيدكم',
  ]) || isNonSaudiDialect(reply)
}

// Code-level backstop for §-dialect: the prompt instructs Saudi dialect only
// (and explicitly forbids other dialects/formal Arabic), but that alone is
// not enforced — this catches the most common, unambiguous Egyptian/Sudanese
// markers so a drifted reply is replaced rather than sent to the customer.
// Deliberately narrow (only words that are NOT also natural Saudi usage) to
// avoid false positives on legitimate Saudi phrasing.
function isNonSaudiDialect(reply: string) {
  return hasAny(reply, [
    'عايز', 'عايزة', 'كمان', 'علشان', 'إزاي', 'ازاي', 'كده', 'النهاردة', 'إمبارح',
    'زول', 'كيفنك', 'شديد كتير', 'ياخ بالله',
    'دلوقتي', 'النهارده', 'امبارح', 'خلاص كده', 'يعني ايه', 'مش كده',
  ])
}

// Conservative: only flag a reply as "repeated" if it is essentially the SAME
// message as a previous one (near-exact — see the 0.85 containment ratio
// below). Previously also skipped this check entirely whenever the reply
// contained ANY digit (meant to avoid flagging legitimate repeated balance/
// account-number answers as "robotic filler") — but that blanket bypass
// meant the agent could send the literal same balance/date reminder
// verbatim multiple times in a row and never get caught, since debt-
// collection replies almost always contain a figure. The ratio+containment
// check below already only matches near-IDENTICAL text, so two different
// sentences that happen to both mention the same balance never collide —
// removing the bypass closes the loophole without reintroducing false
// positives on legitimately-repeated numbers phrased differently.
export function isRepeated(reply: string, prevOutbound: string[]) {
  const r = reply.replace(/\s+/g, ' ').trim()
  if (!r || r.length < 20) return false
  return prevOutbound.some(p => {
    const old = p.replace(/\s+/g, ' ').trim()
    if (!old || old.length < 20) return false
    if (old === r) return true
    // near-duplicate only when lengths are close and one fully contains the other
    const ratio = Math.min(r.length, old.length) / Math.max(r.length, old.length)
    return ratio >= 0.85 && (old.includes(r) || r.includes(old))
  })
}

// Real corrective regeneration — replaces the old approach of substituting a
// canned phrase from a static bank when a guard fires. A static bank only
// avoids literal-text repetition while still asking the customer the exact
// same thing in different words (confirmed root cause of a real production
// incident: 8 differently-worded "متى تقدر تسدد؟" variants in 5 minutes after
// the customer explicitly refused to pay). This re-invokes the model with an
// explicit, specific correction note describing exactly what was wrong, so
// the new reply actually engages with what the customer said instead of
// reshuffling synonyms. Fails closed to `null` on any error — caller must
// supply a safe fallback for that case.
async function regenerateWithCorrection(
  client: OpenAI, modelId: string, systemPrompt: string, turns: { role: 'user' | 'assistant'; content: string }[],
  customerText: string, correctionNote: string,
): Promise<string | null> {
  try {
    const ai = await client.chat.completions.create({
      model: modelId,
      temperature: 0.5,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        ...turns,
        {
          role: 'user',
          content: `رسالة العميل الحالية:\n${customerText}\n\n🔴 ردك السابق على هذه الرسالة كان فيه مشكلة محددة يجب تصحيحها الآن:\n${correctionNote}\n\nأعد رداً جديداً يعالج المشكلة أعلاه فعلياً (لا تكرر نفس الفكرة بصياغة أخرى — تعامل مع كلام العميل الحقيقي). أعد JSON فقط: {"message": "الرد المصحَّح"}`,
        },
      ],
    })
    const obj = extractJson(ai.choices?.[0]?.message?.content ?? '')
    const msg = obj?.message
    return typeof msg === 'string' && msg.trim() ? msg.trim() : null
  } catch (err) {
    log.error('regenerateWithCorrection failed', err as Error)
    return null
  }
}

// Robustly extract a JSON object even when the model wraps it in markdown
// fences or adds prose around it (Claude via OpenRouter often ignores json_object).
function extractJson(raw: string): any | null {
  if (!raw) return null
  let s = String(raw).trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try { return JSON.parse(s) } catch {}
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try { return JSON.parse(s.slice(first, last + 1)) } catch {}
  }
  return null
}

// Format money/dates, skipping nulls so we never feed "null" to the model
function money(amount: any, currency = 'SAR') {
  if (amount === null || amount === undefined || amount === '') return null
  const n = Number(amount)
  if (Number.isNaN(n)) return null
  return `${n.toLocaleString('en-US')} ${currency}`
}

function dateOnly(d: any) {
  if (!d) return null
  const s = String(d)
  return s.length >= 10 ? s.slice(0, 10) : s
}

function addDaysISO(baseISO: string, days: number): string {
  const d = new Date(baseISO + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// A model-provided date is trustworthy only if it parses and lands in a sane
// window relative to the real "today" (a few days back to allow timezone slack,
// up to ~13 months ahead). Prevents storing a hallucinated far-past/future date.
function isSaneDate(iso: string, todayISO: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const t = Date.parse(iso + 'T00:00:00Z')
  const today = Date.parse(todayISO + 'T00:00:00Z')
  if (Number.isNaN(t) || Number.isNaN(today)) return false
  const diffDays = (t - today) / 86_400_000
  return diffDays >= -2 && diffDays <= 400
}

// ════════════════════════════════════════════════════════════════════
//  Case file — the "memory" the agent reviews BEFORE every reply.
//  Pulls verified DB facts, what was agreed, dashboard notes & history.
// ════════════════════════════════════════════════════════════════════

// Resolves the SINGLE correct payment reference for this customer, using
// the EXACT same priority order buildCaseFile uses to decide what to show
// the model (Mobily's service-status rule first, then the per-customer
// SADAD number, then the portfolio's collection account) — so the
// post-model guard below can verify the model's reply actually contains
// this real number instead of leaving it to memory/chance.
function resolvePaymentReference(ctx: any, mobilyRow: Record<string, any> | null | undefined): string | null {
  if (mobilyRow) {
    const pay = resolveMobilyPaymentNumber(mobilyRow)
    if (pay) return pay.value
  }
  const extra = (ctx.debt?.metadata?.extra ?? {}) as Record<string, any>
  const pick = (...keys: string[]) => keys.map(k => extra[k]).find(v => v !== undefined && v !== null && String(v).trim() !== '') ?? null
  const sadadCaseVal = pick('sadad_number', 'رقم سداد', 'رقم السداد', 'sadad', 'biller_number')
  if (sadadCaseVal) return String(sadadCaseVal)
  const acc = ctx.collection_account
  if (acc?.method_type === 'sadad_biller' && acc.biller_code) return String(acc.biller_code)
  if (acc?.iban) return String(acc.iban)
  return null
}

export function buildCaseFile(ctx: any, stcRow?: Record<string, any> | null, mobilyRow?: Record<string, any> | null): string {
  const lines: string[] = []
  const add = (label: string, value: any) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      lines.push(`- ${label}: ${value}`)
    }
  }

  const c = ctx.verified_customer_data ?? {}
  const d = ctx.verified_debt_data ?? {}
  const currency = d.currency || 'SAR'

  // 1) Who am I talking to (verified identity & status)
  lines.push('【 هوية العميل وحالته 】')
  add('الاسم', c.customer_name)
  add('رقم الهوية', c.national_id)
  add('المدينة', c.city)
  add('جهة العمل', c.employer)
  add('مستوى الخطورة', c.risk_level)

  // 2) The debt facts (the ONLY numbers/names allowed)
  // Company/creditor name: creditor_name is the primary source, but it is
  // frequently null for debts created via bulk import (the import pipeline
  // never populates it) — portfolio_name (the company/portfolio the debt was
  // imported under, e.g. "STC"/"موبايلي") is the correct fallback identity in
  // that case. Without this fallback the agent had NO company name to give
  // the customer at all whenever creditor_name was empty, even though the
  // real company name was sitting in portfolio_name the whole time.
  const companyName = d.creditor_name || d.portfolio_name
  lines.push('')
  lines.push('【 بيانات المديونية المؤكدة 】')
  add('الجهة الدائنة / الشركة', companyName)
  add('قطاع الجهة الدائنة', { telecom: 'اتصالات', insurance: 'تأمين', utility: 'مرافق (كهرباء/ماء/طاقة)', recruitment: 'استقدام عمالة', government: 'حكومي', finance: 'تمويل', agriculture: 'زراعي', other: null }[String(d.portfolio_category ?? '').toLowerCase()] ?? null)
  add('نوع المنتج', d.product_type)
  add('رقم الحساب / العقد', d.account_number)
  // §7: `amountDue` is ALWAYS current_balance — original_amount is
  // deliberately never injected here, even though it exists on the debt.
  // Surfacing both numbers side-by-side let the model quote whichever one
  // it picked first, sometimes the stale original amount, without
  // technically "disobeying" the prompt. original_amount is only ever
  // injected in the dedicated sub-path below, triggered specifically when
  // the customer asks why the amount changed.
  add('الرصيد الحالي المستحق', money(d.current_balance, currency))
  add('الرقم المرجعي', d.reference_number)

  // metadata.extra holds portfolio-specific raw columns preserved at import
  // time (e.g. SADAD/biller number, product number) that have no dedicated
  // standard column — these were previously NEVER surfaced to the model at
  // all. Only common, customer-facing identifiers are pulled out by name;
  // the rest of `extra` (internal flags, dates, etc.) stays out of the prompt.
  const extra = (ctx.debt?.metadata?.extra ?? {}) as Record<string, any>
  const pick = (...keys: string[]) => keys.map(k => extra[k]).find(v => v !== undefined && v !== null && String(v).trim() !== '') ?? null
  const sadadCaseVal = pick('sadad_number', 'رقم سداد', 'رقم السداد', 'sadad', 'biller_number')
  add('رقم سداد / المفوتر', sadadCaseVal)
  add('رقم المنتج', pick('رقم المنتج', 'product_number', 'رقم_المنتج'))
  const statusLabels: Record<string, string> = {
    'payment_plan': 'خطة تقسيط معتمدة وفعّالة',
    'active': 'نشط',
    'overdue': 'متأخر',
    'settled': 'تم السداد',
    'written_off': 'شُطب',
    'disputed': 'معترض عليه',
    'legal': 'إجراء قانوني',
  }
  add('حالة الملف', statusLabels[String(d.status ?? '').toLowerCase()] ?? d.status)
  add('تاريخ الاستحقاق', dateOnly(d.due_date))
  add('تاريخ آخر سداد', dateOnly(d.last_payment_date))

  // 2b) Multiple debts under the SAME company/portfolio — list every claim,
  // never just the primary one above. Set by the Customer 360 engine when
  // the customer has more than one debt under one portfolio.
  if (Array.isArray(ctx.verified_debts_list) && ctx.verified_debts_list.length > 1) {
    lines.push('')
    lines.push('【 🔴 مطالبات متعددة لنفس الجهة — اذكرها كلها باختصار، ممنوع ذكر واحدة فقط وتجاهل الباقي 】')
    ctx.verified_debts_list.forEach((dd: any, i: number) => {
      const bal = money(dd.current_balance, dd.currency || currency)
      const parts = [
        dd.reference_number && `مرجع ${dd.reference_number}`,
        dd.account_number && `حساب ${dd.account_number}`,
        bal && `رصيد ${bal}`,
        dd.status && `حالة ${dd.status}`,
      ].filter(Boolean)
      lines.push(`- مطالبة ${i + 1}: ${parts.join('، ')}`)
    })
  }

  if (ctx.open_dispute_record) {
    const od = ctx.open_dispute_record
    lines.push('')
    lines.push(`【 اعتراض مسجّل قيد المراجعة (جدول disputes) 】`)
    lines.push(`- نوعه: ${od.dispute_type ?? 'غير محدد'}${od.description ? ` — ${od.description}` : ''}. لا تسجّل اعتراضاً جديداً، طمئن العميل أنه قيد المراجعة.`)
  }

  // 3) What we already discussed / agreed on (the core of "memory")
  const agreed: string[] = []

  // Detect active installment plan from EITHER: debt status, OR any approved approval mentioning installments
  const debtStatus = String(d.status ?? '').toLowerCase()
  const hasPaymentPlan = debtStatus === 'payment_plan' || debtStatus === 'installment'
  const approvedInstallment = (ctx.recent_approvals ?? []).find((a: any) =>
    a.status === 'approved' && (
      a.approval_type === 'installment' ||
      String(a.title ?? '').includes('تقسيط') ||
      String(a.description ?? '').includes('تقسيط')
    )
  )

  if (hasPaymentPlan || approvedInstallment) {
    agreed.push('✅ يوجد خطة تقسيط معتمدة بالفعل في النظام (حالة الملف: payment_plan). لا ترفض التقسيط ولا تقل إنه يحتاج موافقة — أكّد للعميل أن التقسيط معتمد واسأله عن موعد القسط القادم.')
  }

  const openPromise = (ctx.recent_promises ?? []).find((p: any) => p.status === 'pending')
  if (openPromise) {
    const amt = money(openPromise.promised_amount, currency)
    const dt = dateOnly(openPromise.promised_date)
    const timing = String(openPromise.notes ?? '').match(/توقيت العميل:\s*([^—]+)/)?.[1]?.trim()
    agreed.push(`📌 وعد سداد قائم${amt ? ` بمبلغ ${amt}` : ''}${dt ? ` بتاريخ ${dt}` : ''}${timing ? ` (قاله العميل: ${timing})` : ''} — التزم به وذكّر العميل، و🔴 لا تسأله عن الموعد مرة أخرى فقد سجّلناه.`)
  }

  const pendingDispute = (ctx.recent_approvals ?? []).find((a: any) => a.approval_type === 'dispute' && a.status === 'pending')
  if (pendingDispute) agreed.push('📌 يوجد اعتراض من العميل قيد مراجعة الإدارة الآن. طمئنه أن ملاحظته تُراجع وسيُرد عليه، ولا تضغط عليه بالسداد ولا تسجّل اعتراضاً جديداً.')

  const brokenCount = (ctx.recent_promises ?? []).filter((p: any) => p.status === 'broken').length
  if (brokenCount > 0) agreed.push(`⚠️ العميل أخلف ${brokenCount} وعد سابق — كن أكثر حزماً واطلب تاريخاً محدداً.`)

  const lastPayment = (ctx.recent_payments ?? []).find((p: any) => p.status === 'completed')
  if (lastPayment) {
    const amt = money(lastPayment.amount, lastPayment.currency || currency)
    agreed.push(`💰 آخر سداد مؤكد${amt ? `: ${amt}` : ''}${lastPayment.payment_date ? ` بتاريخ ${dateOnly(lastPayment.payment_date)}` : ''}.`)
  }

  const lastFollowup = ctx.latest_collection_context?.last_followup
  if (lastFollowup) {
    if (lastFollowup.collector_note) agreed.push(`🗒️ آخر ملاحظة محصّل: ${lastFollowup.collector_note}`)
    else if (lastFollowup.result_summary) agreed.push(`🗒️ آخر نتيجة متابعة: ${lastFollowup.result_summary}`)
  }

  const lastStatus = ctx.latest_collection_context?.last_status_change
  if (lastStatus?.normalized_status) agreed.push(`📊 آخر حالة في النظام: ${lastStatus.normalized_status}`)

  if (agreed.length) {
    lines.push('')
    lines.push('【 ما تم نقاشه أو الاتفاق عليه سابقاً (اقرأه جيداً قبل الرد) 】')
    agreed.forEach(a => lines.push(`- ${a}`))
  }

  // 3b) Payment method (give to the customer when they agree to pay).
  // A per-customer SADAD number (sadadCaseVal, from customer_data_<portfolio>
  // .sadad_number / debts.metadata.extra) wins over collection_accounts —
  // a single portfolio-wide collection_accounts row would be the WRONG
  // destination for portfolios like STC where every customer has their own
  // SADAD/biller number. Only fall back to collection_accounts when no
  // customer-specific SADAD number exists.
  // Mobily resolves the payment number from service status (see the Mobily
  // knowledge block below), NOT from sadad_number — so the generic
  // SADAD-first payment block is suppressed for Mobily to avoid handing the
  // customer two conflicting payment numbers. STC and every other portfolio
  // are unaffected.
  const acc = ctx.collection_account
  const payLines: string[] = []
  if (!mobilyRow) {
    if (sadadCaseVal) {
      payLines.push(`طريقة السداد المعتمدة: رقم السداد/المفوتر الخاص بهذا العميل هو ${sadadCaseVal}. وجّه العميل يسدد عبر تطبيق بنكه بهذا الرقم فقط — هذا هو مصدر الدفع المعتمد الوحيد لهذا العميل.`)
    } else if (acc) {
      if (acc.method_type === 'sadad_biller' && acc.biller_code) {
        payLines.push(`طريقة السداد المعتمدة: سداد المفوتر "${acc.biller_name ?? ''}" رمز ${acc.biller_code}. وجّه العميل يسدد عبر تطبيق بنكه بهذا المفوتر.`)
      } else if (acc.iban) {
        payLines.push(`طريقة السداد المعتمدة: تحويل بنكي على الآيبان ${acc.iban}${acc.account_name ? ` باسم ${acc.account_name}` : ''}${acc.bank_name ? ` - ${acc.bank_name}` : ''}. اطلب من العميل إرسال صورة الإيصال بعد التحويل.`)
      }
      if (acc.instructions) payLines.push(`تعليمات إضافية: ${acc.instructions}`)
    }
  }
  if (payLines.length) {
    lines.push('')
    lines.push('【 طريقة الدفع (أعطها للعميل فقط عند اتفاقه على السداد) 】')
    payLines.forEach(l => lines.push(`- ${l}`))
  }

  // 4) Dashboard notes (collector / admin notes added in the panel)
  const notes: string[] = []
  if (ctx.customer?.notes) notes.push(`ملاحظة على العميل: ${ctx.customer.notes}`)
  if (d.notes) notes.push(`ملاحظة على الملف: ${d.notes}`)
  if (notes.length) {
    lines.push('')
    lines.push('【 ملاحظات لوحة التحكم 】')
    notes.forEach(n => lines.push(`- ${n}`))
  }

  // 5) Portfolio-specific operational knowledge — field semantics + (Mobily)
  // the deterministic status-based payment number. Never policy.
  const stcKnowledge = renderStcKnowledgeForCaseFile(stcRow)
  if (stcKnowledge) lines.push(stcKnowledge)
  const mobilyKnowledge = renderMobilyKnowledgeForCaseFile(mobilyRow)
  if (mobilyKnowledge) lines.push(mobilyKnowledge)

  // علم-تم (Tamm) sector context — static knowledge true for every customer
  // on this portfolio (not row-specific data, since no real file has been
  // imported for it yet). "تم" هي منصة المرور الحكومية التي تديرها شركة
  // "عِلم" (Elm) — تتيح إصدار/تجديد رخص المركبات، نقل الملكية، الاستعلام عن
  // المخالفات، والتفويض. عملاؤها غالباً حسابات أعمال (مكاتب تأجير، مؤسسات،
  // معارض سيارات) لا أفراد عاديين، فالمديونية هي رسوم استخدام/اشتراك هذي
  // الخدمات المرورية، وليست غرامة مرورية مباشرة. Confirmed by the user
  // 2026-06-29 — not invented.
  const alamTamProfile = COMPANY_IMPORT_PROFILES.find(p => p.key === 'alam_tam')
  if (alamTamProfile?.aliases.includes(String(d.portfolio_name ?? '').toLowerCase().trim())) {
    lines.push('')
    lines.push('【 معرفة تشغيلية خاصة بـ علم - تم (منصة تم الحكومية) 】')
    lines.push('- "تم" منصة مرورية حكومية تديرها شركة "عِلم" بالتعاون مع المديرية العامة للمرور — تقدّم: استخراج/تجديد رخص المركبات، نقل ملكية، الاستعلام عن المخالفات المرورية، والتفويض.')
    lines.push('- عملاء هذي المحفظة عادةً حسابات أعمال (مكاتب تأجير سيارات، مؤسسات، معارض سيارات) لا أفراد عاديين.')
    lines.push('- المديونية هي رسوم استخدام/اشتراك هذي الخدمات المرورية عبر المنصة — وليست غرامة مرورية مباشرة من المرور نفسه. اشرح هذا للعميل إذا سأل عن طبيعة المبلغ.')
  }

  return lines.join('\n')
}

// ════════════════════════════════════════════════════════════════════
//  Main agent
// ════════════════════════════════════════════════════════════════════

export async function runCollectorAgent(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  message: string
  conversation_history?: HistoryItem[]
  // When the customer actually sent this message (ISO string) — used ONLY
  // by the Temporal Intelligence Engine Shadow Mode comparison below; the
  // existing decision pipeline is untouched and still uses its own
  // processing-time "today". Optional so every existing caller/test keeps
  // working unchanged; defaults to "now" if omitted.
  messageTimestamp?: string
}): Promise<CollectorDecision> {
  let text = args.message.trim()
  let signals = detectSignals(text)

  // ════════════════════════════════════════════════════════════════════
  //  PRE-MODEL PIPELINE (§0) — fixed execution order, each step a circuit
  //  breaker that can stop everything below it (including the LLM call):
  //    1. crisis_distress_gate            [this block, §3]
  //    2. stop_contact_gate               [this block, §2]
  //    3. identity_verification_gate      [this block, §1]
  //    4. multi_portfolio_clarification_gate  [below, §4]
  //  repeated_question_guard is NOT pre-model despite the spec's suggested
  //  list — it compares the MODEL's draft reply against the agent's last
  //  question, so it cannot run before the LLM call exists. It stays in its
  //  documented position in the POST-MODEL pipeline below (step 9).
  // ════════════════════════════════════════════════════════════════════

  // §3 — Severe distress gate. Must run before EVERYTHING else, including
  // identity verification — a person in acute distress is never made to
  // jump through a verification challenge first. This is a circuit breaker
  // only: one calming line + an alert for a human to follow up, no attempt
  // at intervention by the agent itself.
  if (detectSevereDistress(text)) {
    log.warn('severe distress signal detected — zero LLM call, routed to human', { customer_id: args.customer_id, debt_id: args.debt_id ?? null, message_preview: text.slice(0, 120) })
    await raiseUrgentHumanAlert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      alert_type: 'distress_signal',
      title: 'إشارة ضيق نفسي حاد من عميل',
      message: `رسالة العميل: "${text}"`,
    })
    return { shouldReply: true, action: 'human_review', reason: 'distress_signal', message: renderDistressReply() }
  }

  // §2 — Stop-contact / opt-out gate. Once a customer has opted out, EVERY
  // subsequent automated message is suppressed — no exceptions, regardless
  // of what the message says. The opt-out itself gets exactly one fixed
  // confirmation reply, never repeated.
  const gateState = await getCustomerGateState(args.customer_id)
  if (gateState.contact_opt_out) {
    return { shouldReply: false, action: 'silent', reason: 'contact_opt_out_active', message: '' }
  }
  if (detectOptOutIntent(text)) {
    log.warn('opt-out intent detected — disabling future automated messages', { customer_id: args.customer_id })
    await setContactOptOut(args.customer_id)
    await raiseUrgentHumanAlert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      alert_type: 'contact_opt_out',
      title: 'عميل طلب إيقاف التواصل',
      message: `رسالة العميل: "${text}"`,
    })
    return { shouldReply: true, action: 'human_review', reason: 'contact_opt_out', message: renderOptOutConfirmation() }
  }

  // §1 — Identity verification gate REMOVED entirely per the owner's explicit,
  // repeated business decision: the agent must NEVER ask the customer for ID
  // last-4 ("قبل أي تفاصيل، أحتاج تأكيد هويتك ...") on any portfolio. First
  // contact confirms the recipient by name instead (handled in the prompt /
  // introduction flow), and the pipeline proceeds normally without an ID
  // challenge. (Deliberate trade-off accepted by the owner.)

  // Fast path: customer ended the chat → stay silent, no cost.
  if (isCloser(text)) {
    return { shouldReply: false, action: 'close_conversation', reason: 'customer_closed_chat', message: '' }
  }

  // ── Customer 360 — see every debt this customer has before picking one.
  // The webhook may pass a single `debt_id` hint (its own "latest debt"
  // guess), but that guess must never override real multi-portfolio
  // ambiguity: if the customer's message is debt-related and they have
  // debts under more than one company/portfolio, we resolve that here,
  // deterministically, before any LLM call.
  const ctx360 = await buildCustomer360Context({ company_id: args.company_id, customer_id: args.customer_id })
  // §4 — If the customer's PREVIOUS message was left ambiguous awaiting a
  // company clarification, fold it into this message before resolving so a
  // second intent bundled into that original message is never lost (e.g.
  // "متى موعد سداد الراجحي، وهل ممكن تقسيط؟" → clarifies "الراجحي" → the
  // installment question must still be answered, not silently dropped).
  const pendingClar = gateState.pending_clarification
  const effectiveText = pendingClar?.originalMessage
    ? `${pendingClar.originalMessage} ${text}`.trim()
    : text
  if (pendingClar?.originalMessage) {
    await clearPendingClarification(args.customer_id)
    text = effectiveText
    signals = detectSignals(text)
  }
  const debtRelated = isDebtRelatedMessage(effectiveText)
  let forcedDebtId: string | null = args.debt_id ?? null
  let verifiedDebtsList: any[] | null = null
  let resolvedGroup: typeof ctx360.debtGroups[number] | null = null

  if (ctx360.debtGroups.length > 1) {
    if (debtRelated) {
      const selection = selectDebtGroup(ctx360.debtGroups, effectiveText)
      if (selection.mode === 'needs_clarification') {
        const names = selection.groups.map(g => g.portfolio_name || 'بدون اسم شركة محدد').join(' / ')
        log.info('multi-portfolio clarification requested — zero LLM call', { customer_id: args.customer_id, names })
        await setPendingClarification(args.customer_id, effectiveText)
        return {
          shouldReply: true,
          action: 'request_clarification',
          reason: 'multi_portfolio_clarification_needed',
          message: `عندك أكثر من ملف مديونية معنا. تقصد مطالبة أي شركة: ${names}؟`,
        }
      }
      const group = selection.group!
      resolvedGroup = group
      if (group.debts.length > 1) {
        forcedDebtId = pickPrimaryDebt(group.debts)?.id ?? forcedDebtId
        verifiedDebtsList = group.debts.map(mapDebtForList)
      } else {
        forcedDebtId = group.debts[0]?.id ?? forcedDebtId
      }
    }
    // Not debt-related (greeting / "من أنت" / general chat) → never force a
    // company choice; let the conversation continue without picking one.
  } else if (ctx360.debtGroups.length === 1) {
    const group = ctx360.debtGroups[0]
    resolvedGroup = group
    if (group.debts.length > 1 && debtRelated) {
      forcedDebtId = pickPrimaryDebt(group.debts)?.id ?? forcedDebtId
      verifiedDebtsList = group.debts.map(mapDebtForList)
    } else if (group.debts.length === 1) {
      forcedDebtId = group.debts[0].id
    }
  }

  // ── Legal Escalation lock — checked BEFORE anything else (including the
  // LLM). If this debt has an open legal escalation, خالد never replies
  // again; only the fixed legal persona does, deterministically, until an
  // admin/manager closes it. No negotiation, pressure, discount, or
  // installment offer can ever slip through this gate.
  if (forcedDebtId) {
    const openEsc = await getOpenEscalation(args.company_id, forcedDebtId)
    if (openEsc) {
      // 'repeated_refusal' is the one escalation type that actually
      // converses — a dynamic "lawyer persona" reply, not the fixed line.
      // Needs a quick case summary; cheap inline fetch since `ctx` (the
      // full case file) isn't built yet at this point in the pipeline.
      if (openEsc.escalation_type === 'repeated_refusal') {
        log.info('legal escalation lock active — lawyer persona reply', { debt_id: forcedDebtId })
        let caseSummary = 'لا تفاصيل إضافية متاحة.'
        try {
          const { data: debtRow } = await createServiceClient()
            .from('debts').select('current_balance, currency, reference_number, portfolio:portfolios(name_ar, name)')
            .eq('id', forcedDebtId).maybeSingle()
          if (debtRow) {
            const d = debtRow as any
            caseSummary = `الجهة: ${d.portfolio?.name_ar ?? d.portfolio?.name ?? 'غير محدد'} | المبلغ المتأخر: ${d.current_balance ?? '—'} ${d.currency ?? 'SAR'} | الرقم المرجعي: ${d.reference_number ?? '—'}`
          }
        } catch { /* keep default summary */ }
        const lawyerReply = await generateLawyerPersonaReply({
          customerMessage: text, caseSummary, reason: openEsc.reason,
        })
        return {
          shouldReply: true, action: 'human_review',
          reason: 'legal_escalation_locked_lawyer_persona', message: lawyerReply,
          resolvedDebtId: forcedDebtId,
        }
      }
      log.info('legal escalation lock active — zero LLM call', { debt_id: forcedDebtId, escalation_type: openEsc.escalation_type })
      return {
        shouldReply: true,
        action: 'human_review',
        reason: 'legal_escalation_locked',
        message: renderLegalPersonaReply(openEsc.escalation_type),
        resolvedDebtId: forcedDebtId,
      }
    }
  }

  // ── Always review the case file + history from the DB BEFORE replying ──
  const ctx: any = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: forcedDebtId,
  })
  if (verifiedDebtsList) ctx.verified_debts_list = verifiedDebtsList
  const openDispute = (ctx360.allDisputes ?? []).find((d: any) => d.status === 'pending' || d.status === 'open')
  if (openDispute) ctx.open_dispute_record = openDispute

  // ── Phase 2: Company Playbook — load the policy for the resolved
  // portfolio (or the category default when no playbook row exists yet).
  // Discount/installment limits and the dispute-type whitelist come from
  // here; insurance-only concepts are stripped for every other category
  // both here (data) and again later (a hard code guard on the reply).
  const resolvedCategory = (resolvedGroup?.portfolio_category ?? ctx.verified_debt_data?.portfolio_category ?? 'other') as import('@/lib/company-playbook').PortfolioCategory
  const resolvedPortfolioId = resolvedGroup?.portfolio_id ?? (ctx.debt as any)?.portfolio_id ?? null
  // STC-specific identity check — gated on the portfolio NAME (matched
  // against STC's own alias list from company-import-profiles.ts, since
  // the real DB row is named "إس تي سي", not the Latin "STC"), not the
  // broader 'telecom' category, so this never affects other telecom
  // portfolios (e.g. Mobily). STC's policy bans the legal/lockout path
  // entirely; see suppressLegalTriggers below.
  const resolvedPortfolioName = String(resolvedGroup?.portfolio_name ?? ctx.verified_debt_data?.portfolio_name ?? '').trim().toLowerCase()
  const stcProfile = COMPANY_IMPORT_PROFILES.find(p => p.key === 'stc')
  const isStcPortfolio = !!resolvedPortfolioName && !!stcProfile?.aliases.includes(resolvedPortfolioName)
  // Mobily — same NAME-based gating as STC (real DB row is "موبايلي", not
  // "Mobily"), so it never affects STC or any other telecom portfolio.
  const mobilyProfile = COMPANY_IMPORT_PROFILES.find(p => p.key === 'mobily')
  const isMobilyPortfolio = !!resolvedPortfolioName && !!mobilyProfile?.aliases.includes(resolvedPortfolioName)
  // Owner-specified exclusion (2026-06-28) from the repeated-refusal →
  // lawyer-persona escalation: STC, Saudi Energy, and National Water never
  // get this automatic escalation, regardless of refusal count.
  const saudiEnergyProfile = COMPANY_IMPORT_PROFILES.find(p => p.key === 'saudi_energy')
  const isSaudiEnergyPortfolio = !!resolvedPortfolioName && !!saudiEnergyProfile?.aliases.includes(resolvedPortfolioName)
  const nationalWaterProfile = COMPANY_IMPORT_PROFILES.find(p => p.key === 'national_water')
  const isNationalWaterPortfolio = !!resolvedPortfolioName && !!nationalWaterProfile?.aliases.includes(resolvedPortfolioName)
  // Companies where court/legal language is banned entirely, even as a
  // negotiation tactic — same exclusion list as the legal-escalation
  // tracker (trackRefusalForLegalEscalation above). Previously only
  // isStcPortfolio was excluded from the general "تصعيد قانوني" mentions
  // below, leaving Saudi Energy/National Water customers hearing legal-
  // escalation language by mistake despite being on the exclusion list.
  const bansLegalTone = isStcPortfolio || isSaudiEnergyPortfolio || isNationalWaterPortfolio
  const playbook = await getPlaybookForPortfolio({
    company_id: args.company_id,
    portfolio_id: resolvedPortfolioId,
    category: resolvedCategory,
  })

  // ── Phase 3: Insurance Engine — classification is 100% data-driven from
  // customer_data_tawuniya/medgulf (already fetched by Phase 1's context
  // engine). Only ever built for category='insurance'; for every other
  // category this stays null and nothing insurance-specific is injected.
  const isInsurancePortfolio = playbook.category === 'insurance'
  const insuranceRow = isInsurancePortfolio
    ? (ctx360.customerDataByPortfolio?.[resolvedPortfolioId ?? 'no_portfolio'] ?? [])[0]
    : null
  const insuranceCase = insuranceRow ? classifyInsuranceCase(insuranceRow) : null
  const insuranceObjection = isInsurancePortfolio ? detectInsuranceObjectionSignals(text) : null

  // ── Repeated-refusal tracking → IMMEDIATE legal escalation, same turn.
  // 🔴 Real gap found live (customer حذيفه, 2026-07-08): this used to only
  // feed a separate cron requiring 48 HOURS since the first refusal before
  // acting — the customer refused explicitly 5+ times within one hour in a
  // single conversation and nothing happened; they were never told anything
  // either. Now reacts the SAME turn the threshold is crossed: opens the
  // escalation immediately and tells the customer directly (a live legal
  // notice), instead of silently waiting on a slow batch job. The
  // legal-escalation-check cron remains as a slower safety net only (in case
  // this write path itself ever fails). Excluded entirely for STC, Saudi
  // Energy, and National Water per owner instruction.
  if (forcedDebtId && signals.refusesToPay && !isStcPortfolio && !isSaudiEnergyPortfolio && !isNationalWaterPortfolio) {
    const tracking = await trackRefusalForLegalEscalation({ debt_id: forcedDebtId })
    if (tracking && tracking.count >= REFUSAL_THRESHOLD) {
      const opened = await openEscalation({
        company_id: args.company_id, customer_id: args.customer_id, debt_id: forcedDebtId,
        portfolio_id: resolvedPortfolioId, escalation_type: 'repeated_refusal',
        reason: `رفض/مماطلة متكررة (${tracking.count} مرات)، أول رفض منذ ${tracking.first_at}`,
      })
      if (opened) {
        return {
          shouldReply: true, action: 'human_review',
          reason: 'repeated_refusal_escalated_live', message: renderRepeatedRefusalNotice(),
          resolvedDebtId: forcedDebtId,
        }
      }
    }
  }

  // ── Mandatory legal escalation — checked deterministically BEFORE the
  // LLM call (legal_threat/lawyer_mention/complaint apply to every sector
  // EXCEPT STC, whose policy bans the legal/lockout path entirely —
  // suppressLegalTriggers below; the insurance-specific types only ever
  // fire for an actual insurance portfolio, driven by the Phase 3 Insurance
  // Engine's own classification — never a separate guess). Once detected,
  // this debt's conversation is locked for every subsequent turn via the
  // check above.
  if (forcedDebtId) {
    const mandatory = detectMandatoryEscalation({
      text,
      isInsurancePortfolio,
      insuranceObjection,
      insuranceCase,
      customEscalationRules: playbook.escalation_rules,
      suppressLegalTriggers: bansLegalTone,
    })
    if (mandatory) {
      await openEscalation({
        company_id: args.company_id,
        customer_id: args.customer_id,
        debt_id: forcedDebtId,
        portfolio_id: resolvedPortfolioId,
        escalation_type: mandatory.escalation_type,
        reason: mandatory.reason,
      })
      log.info('legal escalation opened — zero LLM call on this turn', { debt_id: forcedDebtId, escalation_type: mandatory.escalation_type })
      return {
        shouldReply: true,
        action: 'human_review',
        reason: 'legal_escalation_opened',
        message: renderLegalPersonaReply(mandatory.escalation_type),
        resolvedDebtId: forcedDebtId,
      }
    }

    // 🔴 Customer personally invoking a lawyer/court/complaint is now judged
    // by the model itself AFTER it reads the full message (see
    // parsed.legal_escalation_trigger further below) instead of a pre-model
    // keyword scan — the keyword version couldn't tell "the customer is
    // personally threatening us" from "the customer is quoting/forwarding
    // something we sent them" (real incident, see detectMandatoryEscalation's
    // comment). trackRefusalForLegalEscalation above still independently
    // tracks the separate 3-refusals pattern.

    // STC only: a complaint about the company/service is logged for human
    // visibility (customer_complaint/stc_review) WITHOUT freezing the
    // conversation — the agent keeps talking normally on this same turn.
    if (isStcPortfolio) {
      const stcSignal = detectStcReviewSignal(text)
      if (stcSignal) {
        await recordStcReview({
          company_id: args.company_id,
          customer_id: args.customer_id,
          debt_id: forcedDebtId,
          portfolio_id: resolvedPortfolioId,
          escalation_type: stcSignal.escalation_type,
          reason: stcSignal.reason,
        })
        log.info('STC review signal recorded — conversation continues normally', { debt_id: forcedDebtId, escalation_type: stcSignal.escalation_type })
      }
    }
  }

  // Build chronological conversation (DB returns newest-first → reverse it).
  // Drop the trailing inbound if it duplicates the current message.
  const rawMessages: HistoryItem[] = (ctx.recent_messages ?? []).map((m: any) => ({
    direction: m.direction,
    content: String(m.content ?? ''),
  }))
  const chronological = [...rawMessages].reverse()
  if (
    chronological.length &&
    chronological[chronological.length - 1].direction === 'inbound' &&
    chronological[chronological.length - 1].content.trim() === text
  ) {
    chronological.pop()
  }

  // Real production root cause of "the agent repeated the exact same
  // sentence later in the conversation": this used to only look at the
  // LAST 5 outbound messages, so a sentence said 6+ replies ago was
  // completely invisible to isRepeated() below — it wasn't a fuzzy-match
  // miss, the guard simply never saw it.
  //
  // The MODEL's own context (`turns` further below) is deliberately still
  // capped (~40 turns) — feeding an LLM call the entire lifetime of a
  // months-long debt would blow the token budget and slow every reply. But
  // "never repeat the exact same sentence" does NOT need the LLM at all —
  // it's a plain text-equality/containment check, so it can safely look at
  // the debt's ENTIRE outbound history regardless of conversation length, at
  // negligible cost (one lightweight text-only query, no tokens). This
  // guarantees the "never repeat, no matter how long the conversation"
  // requirement independently of whatever window the model itself sees.
  // Started now but NOT awaited until right before it's actually needed
  // (just before the anti-repetition check, after the LLM call below) — the
  // DB round-trip overlaps with the model API call's latency instead of
  // adding to it serially. A first version of this fix awaited it here
  // eagerly on every single turn, which measurably slowed every reply even
  // when the result ended up unused.
  const fullOutboundHistoryPromise: Promise<{ content: string | null }[] | null> = (async () => {
    if (!forcedDebtId) return null
    try {
      // customer_id + (debt_id match OR debt_id null) — same fix as
      // debt-status-classifier.ts/case-note.ts: an opener message sent
      // before the debt resolved (debt_id=null) would otherwise be
      // permanently invisible to this repeat-check once the debt resolves.
      const { data } = await createServiceClient()
        .from('messages').select('content')
        .eq('customer_id', args.customer_id)
        .or(`debt_id.eq.${forcedDebtId},debt_id.is.null`)
        .eq('direction', 'outbound')
        .order('sent_at', { ascending: true }).limit(500)
      return data ?? null
    } catch (err) {
      log.warn('full outbound history query for repeat-check failed — using capped fallback window', { debt_id: forcedDebtId, error: String(err) })
      return null
    }
  })()
  let prevOutbound = chronological.filter(m => m.direction === 'outbound').map(m => m.content)
  const lastAgentMessage = prevOutbound[prevOutbound.length - 1] ?? ''
  const hasHistory = chronological.length > 0

  // Pure greeting with NO prior history → light canned reply (true first contact).
  // If there IS history, fall through to the AI so it uses what was discussed.
  if (isGreeting(text) && !hasHistory) {
    let msg = 'يا هلا بك، تفضل؟'
    if (text.includes('سلام')) msg = 'وعليكم السلام، حياك الله تفضل؟'
    else if (text.includes('مساء')) msg = 'مساء النور، تفضل؟'
    else if (text.includes('صباح')) msg = 'صباح النور، تفضل؟'
    return { shouldReply: true, action: 'reply', reason: 'greeting_first_contact', message: msg }
  }

  // A PURE greeting mid-conversation (e.g. the customer opens a new day with
  // "السلام عليكم" and nothing else) must never be answered by jumping
  // straight to the debt/payment — only ever fall through to GENERAL/
  // NEGOTIATION's payment-pushing templates when this message carries other
  // content. Deliberately narrow: short message, no other detected signal at
  // all, so a real question or commitment riding along with the greeting
  // still falls through to the normal AI pipeline below untouched.
  if (
    isGreeting(text) && hasHistory && text.trim().length <= 25 &&
    !signals.dispute && !signals.angry && !signals.promise && !signals.installment &&
    !signals.hardship && !signals.asksWhoAreYou && !signals.asksCompany &&
    !signals.asksDetails && !signals.paymentClaim && !signals.deniesDebt && !signals.wrongNumber
  ) {
    let msg = 'هلا فيك، تفضل.'
    if (text.includes('سلام')) msg = 'وعليكم السلام، تفضل.'
    else if (text.includes('مساء')) msg = 'مساء النور، تفضل.'
    else if (text.includes('صباح')) msg = 'صباح النور، تفضل.'
    return { shouldReply: true, action: 'reply', reason: 'greeting_mid_conversation', message: msg }
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return { shouldReply: true, action: 'reply', reason: 'fallback_no_api_key', message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.' }
  }

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  // ── Intent router ──
  type AgentIntent = 'GREETING' | 'SELF_INTRO' | 'INTRODUCTION' | 'INFO_REQUEST' | 'NEGOTIATION' | 'DISPUTE' | 'WRONG_NUMBER' | 'ABSHER_CONFIRMED' | 'GENERAL'
  let intent: AgentIntent = 'GENERAL'

  // أبشر (Absher) verified customers: the number was imported from the
  // government-verified Absher record, so a "this isn't my number" claim is
  // NOT accepted at face value — the collector must not stop or apologize
  // and walk away. Set at import time (debts/import route). How the agent
  // handles a wrong-number claim on such a customer is decided below.
  const absherVerified = (ctx.customer?.metadata as Record<string, unknown> | null)?.absher_verified === true
  // Has the customer claimed wrong-number BEFORE in this same conversation?
  // A first claim is met with a firm, confident push-back; a repeated/
  // insistent claim is escalated to a human reviewer instead — never an
  // auto-stop, since the debt stays valid and the number stays confirmed.
  const priorWrongNumberClaims = chronological.filter(
    h => h.direction === 'inbound' && hasAny(String(h.content ?? ''), ['الرقم غلط', 'ما يخصني', 'مو رقمي', 'wrong number', 'مب رقمي', 'ليس رقمي']),
  ).length

  const balance = ctx.verified_debt_data?.current_balance != null ? String(ctx.verified_debt_data.current_balance) : null
  const creditor = ctx.verified_debt_data?.creditor_name ?? null
  const isTelecom = String(ctx.verified_debt_data?.portfolio_category ?? '').toLowerCase() === 'telecom'
  const historyText = chronological.map(h => h.content).join(' ')
  // Deliberately the AMOUNT only, not the creditor name — the SELF_INTRO
  // stage now names the creditor ("وكيل [الجهة]") before the amount is ever
  // revealed, so creditor-name presence alone can no longer be used as a
  // proxy for "the debt itself has been disclosed".
  const hasMentionedDebt = !!(balance && historyText.includes(balance))
  // True only on the very first inbound ever (no prior outbound from us yet) —
  // we greet first and bring up the debt only once the customer has replied.
  const isFirstEverContact = chronological.every(h => h.direction !== 'outbound')
  // The agent must confirm it's speaking to the right person ("معي الأخ
  // فلان؟") BEFORE naming itself/the company, and only name itself AFTER
  // that confirmation, before ever revealing the debt — three distinct
  // stages, never collapsed into one message.
  const hasIntroducedSelf = historyText.includes('خالد الدويحي') || historyText.includes('مصدر الرؤية')

  // Explicit identity/company/detail questions and bare debt denials are
  // checked FIRST, with priority over the staged greeting→introduction flow
  // and turn-count limits — a direct question must always be answered, not
  // deferred because the conversation is still "early".
  // STC-only: a question about what an operational field MEANS (service
  // number, account number, baqa_flag, status/establish dates, sadad
  // number, late balance) must route to INFO_REQUEST so the STC knowledge
  // block actually gets answered instead of falling through to GENERAL's
  // pressure-oriented template. Strictly gated on isStcPortfolio so no
  // other portfolio's intent classification changes.
  const asksStcFieldMeaning = isStcPortfolio && detectStcFieldMeaningQuestion(text)
  // Same as STC: a Mobily operational-field / payment-number question routes
  // to INFO_REQUEST so the Mobily knowledge block is answered directly,
  // never falling through to GENERAL's pressure template. Gated on Mobily.
  const asksMobilyFieldMeaning = isMobilyPortfolio && detectMobilyFieldMeaningQuestion(text)
  // Same pattern: "البرنت" ("what does البرنت mean?") must route to
  // INFO_REQUEST so the insurance knowledge block above actually answers it
  // — the real incident this fixes: the agent asked the customer "وش تقصد
  // بالبرنت؟" instead of recognizing it as standard terminology for the
  // traffic department's accident report.
  const asksInsuranceFieldMeaning = isInsurancePortfolio && hasAny(text, ['برنت', 'البرنت'])
  // Real production bug this fixes: "wrong number" (someone other than the
  // customer replying, e.g. "مين فلان؟"/"غلط الرقم") used to be folded into
  // the generic DISPUTE intent — a prompt whose entire framing is "discuss
  // and convince the customer their debt is valid," completely wrong for
  // someone who isn't the customer at all. Worse, it was checked AFTER the
  // GREETING/SELF_INTRO/INTRODUCTION branches, none of which excluded it —
  // on first contact this signal was silently ignored entirely and the
  // conversation proceeded as GREETING as if nothing had been said. Checked
  // first, unconditionally, regardless of conversation stage: a wrong-number
  // claim must never be missed or misrouted into any other flow.
  if (signals.wrongNumber) {
    // Absher-verified → never accept the claim; push back (or escalate to a
    // human on repeated insistence) instead of the normal apologize-and-stop.
    intent = absherVerified ? 'ABSHER_CONFIRMED' : 'WRONG_NUMBER'
  } else if (signals.asksWhoAreYou || signals.asksCompany || signals.asksDetails || asksStcFieldMeaning || asksMobilyFieldMeaning || asksInsuranceFieldMeaning) {
    intent = 'INFO_REQUEST'
  } else if (signals.deniesDebt) {
    intent = 'DISPUTE'
  } else if (!hasMentionedDebt && isFirstEverContact && !signals.angry && !signals.dispute) {
    intent = 'GREETING'
  } else if (!hasMentionedDebt && !hasIntroducedSelf && chronological.length <= 3 && !signals.angry && !signals.dispute) {
    intent = 'SELF_INTRO'
  } else if (!hasMentionedDebt && chronological.length <= 5 && !signals.angry && !signals.dispute) {
    intent = 'INTRODUCTION'
  } else if (signals.angry || signals.dispute) {
    intent = 'DISPUTE'
  } else if (signals.promise || signals.installment || signals.hardship) {
    intent = 'NEGOTIATION'
  }

  // Is there an installment plan ALREADY approved in the system?
  const debtStatusLc = String(ctx.verified_debt_data?.status ?? '').toLowerCase()
  const planActive = debtStatusLc === 'payment_plan' || debtStatusLc === 'installment'
    || (ctx.recent_approvals ?? []).some((a: any) =>
        a.status === 'approved' && (
          a.approval_type === 'installment' ||
          String(a.title ?? '').includes('تقسيط') ||
          String(a.description ?? '').includes('تقسيط')
        ))

  const installmentRule = isStcPortfolio
    // STC policy bans the agent from proposing/mentioning installments at
    // all, even as a negotiation tactic — only ever a customer-INITIATED
    // request gets recorded and forwarded, never negotiated or approved.
    ? `- 🔴🔴 ممنوع منعاً باتاً أن تقترح أو تذكر التقسيط ابتداءً بأي صياغة — لا كحل، لا كخيار، لا كمثال. لا تطرح الفكرة على العميل مهما طالت المفاوضة.
  - إذا طلب العميل التقسيط بنفسه وبشكل صريح فقط: سجّل الطلب وارفعه للمراجعة (action=record_installment_request) دون وعد بالموافقة ودون اقتراح أي جدول/مبلغ شهري/عدد دفعات من عندك.
  - في كل الحالات الأخرى: تفاوض على السداد الكامل أو دفعة الآن، بدون أي إشارة للتقسيط.`
    : planActive
    ? '- ✅ يوجد تقسيط معتمد مسبقاً في النظام: أكّد للعميل أن خطته معتمدة واطلب موعد القسط القادم فقط. لا تغيّر شروط الخطة.'
    : `- 🔴🔴 ممنوع منعاً باتاً أن تقترح أو تذكر التقسيط ابتداءً من عندك بأي صياغة — لا كحل، لا كخيار، لا كمثال، بغض النظر عن مبلغ الدين. الفكرة لا تُطرح إلا إذا طلبها العميل بنفسه أولاً.
  - لا تملك صلاحية اعتماد تقسيط أو تحديد مبلغ شهري/عدد دفعات بنفسك بأي حال — هذا قرار الإدارة دوماً، ولو طلبه العميل وأصررت أنت على رفضه بدل رفعه فهذا خطأ أيضاً.
  - أولاً (الأهم): حاول كمحصّل خبير إقناعه بالسداد الكامل أو دفعة كبيرة مقدّمة الآن (اربطها بمصلحته: إغلاق الملف، تجنّب التصعيد، راحة البال). تفاوض بذكاء قبل أي شيء — ولا تذكر التقسيط أبداً خلال هذا التفاوض.
  - فقط إذا طلب العميل التقسيط بنفسه وبشكل صريح: اطلب منه أن يقترح هو التصوّر الذي يناسبه (كم دفعة وكم شهرياً ومتى يبدأ)، وقل له بأسلوب بشري إنك سترفع طلبه للإدارة للنظر فيه دون أن تعده بالموافقة، واختر action=record_installment_request. لا تذكر أرقاماً أو جدولاً من عندك إطلاقاً، ولا توافق ولا ترفض الطلب من نفسك — الإدارة فقط تقرر، بغض النظر عن حجم المبلغ.
  - الهدف: تبدو كمحصّل يحاور ويحاول الحل، لا كموظف يحوّل كل شيء للإدارة فوراً ولا كمن يطرح حلولاً لم يطلبها العميل.`

  const intentPrompts: Record<AgentIntent, string> = {
    GREETING: `【 مهمتك الآن: تأكيد الهوية فقط — لا تعريف بنفسك ولا بالدين 】
- هذه أول رسالة من العميل ولم تتحدثا من قبل. ابدأ بتحية طبيعية (السلام عليكم).
- 🔴 لا تذكر اسمك ولا أنك خالد ولا أي شركة في هذه الرسالة إطلاقاً.
- اسأله سؤال تأكيد هوية: "معي الأخ [اسمه]؟" أو "معي الأخت [اسمها]؟" حسب اسمه في ملف القضية، وانتظر تأكيده.
- 🔴 ممنوع تماماً ذكر أي شيء عن الدين أو المبلغ أو الجهة الدائنة أو اسمك في هذه الرسالة بالذات.
- سطر واحد قصير فقط.`,
    SELF_INTRO: `【 مهمتك الآن: التعريف بنفسك وبالجهة فقط — لا تذكر الدين بعد 】
- العميل أكّد أنه الشخص المطلوب (أو رد بشكل عام يفهم منه ذلك). الآن، وفقط الآن، عرّف نفسك: "معك خالد الدويحي من شركة مصدر الرؤية، وكيل [اسم الجهة الدائنة من ملف القضية]".
- استخدم اسم الجهة الدائنة الحقيقي من "ملف القضية" بالضبط — لا تخترع اسماً ولا تتركه عاماً.
- 🔴 ممنوع ذكر المبلغ أو أي تفصيل عن المديونية في هذه الرسالة — فقط التعريف بنفسك وبالجهة. اسأله سؤالاً عاماً يفتح الحوار (مثل: كيف حالك معهم / تعرف سبب تواصلي معك؟) أو فقط انتظر رده.
- سطر أو سطرين قصيرين فقط.
- ⚠️ إذا أنكر العميل أنه الشخص المطلوب ("مين فلان"، "غلط الرقم"، إلخ) في رده الحالي: لا تكمل التعريف بالجهة، تعامل مع هذا كرقم خطأ بدلاً من ذلك.`,
    INTRODUCTION: `【 مهمتك الآن: ذكر تفاصيل الدين 】
- العميل سبق وأكّد هويته وعرفت نفسك له. الآن وفقط الآن عرّفه بتفاصيل المديونية القائمة.
- اذكر اسم الجهة (إن لم تكن ذكرتها قبل) ونوع المنتج/الخدمة (إن وُجد في ملف القضية، مثل "خط Postpaid 200 Enhanced") والمبلغ مرة واحدة فقط، ثم اسأله مباشرة: متى يقدر يسدد؟ 🔴 ذكر نوع المنتج هنا مهم — يوضّح للعميل عن أي شيء بالضبط هذا الدين بدل ما يبقى سؤالاً غامضاً عنده لاحقاً.
- سؤال واحد فقط، لا أكثر.`,
    INFO_REQUEST: `【 مهمتك الآن: الرد المباشر على سؤال العميل من بيانات النظام 】
- العميل سأل سؤالاً مباشراً: من أنت، أو وش الشركة/الجهة، أو طلب تفاصيل أكثر عن ملفه.
- 🔴 إذا سأل "من أنت؟" أو ما يشابهها: يجب أن تتضمن إجابتك هذي الحقائق الثلاثة فعلاً (اسمك خالد الدويحي، أنك من شركة مصدر الرؤية، أنك وكيل متابعة مطالبات شركة [الجهة] — استبدل [الجهة] باسم الجهة/المحفظة من "ملف القضية" إن وُجد) لكن بصياغتك الطبيعية الخاصة المتماشية مع سياق الحوار، لا نصاً مكرراً حرفياً كل مرة.
- إذا سأل عن الشركة/الجهة: اذكر اسم الجهة الدائنة أو المحفظة كما هو في "ملف القضية" بالضبط. لا تقل "ما عندي معلومة" أو "أرجع للإدارة" إذا كان الاسم موجوداً في الملف.
- إذا طلب "التفاصيل": اذكر كل ما هو متاح فعلياً في ملف القضية بصيغة واضحة ومرتبة (الجهة، 🔴 نوع المنتج/الخدمة إن وجد — مهم جداً لأنه يوضّح للعميل عن أي شيء الدين أصلاً، رقم الحساب، رقم المنتج/السداد إن وجد، المبلغ، الرقم المرجعي) — لا تكتفِ بالمبلغ والرقم المرجعي فقط إن وُجدت تفاصيل إضافية في الملف. ممنوع حذف نوع المنتج من الإجابة إذا كان موجوداً في ملف القضية.
- 🔴 لا تطلب من العميل معلومة هو من المفروض أن يحصل عليها منك (مثل رقم حسابه) — أنت من يملك هذي المعلومة ويعطيها له، لا العكس.
- إن كانت بعض التفاصيل المطلوبة فعلاً غير موجودة في الملف (لا اسم جهة ولا رقم حساب ولا أي شيء): وضّح فقط أن هذا الجزء بالذات غير متوفر حالياً، وقل إنك ستتحقق منه، بدل التعميم بأن "كل شيء غير معروف".
- 🔴 حادثة حقيقية: عميل طلب "الفاتورة" فرد الوكيل فقط "تقدر تطلبها من موبايلي مباشرة" بدون أي معلومة فعلية — رد فارغ رغم توفر بيانات حقيقية في ملف القضية. إذا طلب العميل الفاتورة/فاتورته: عامله بالضبط كطلب "التفاصيل" أعلاه — اذكر أولاً كل ما هو متاح فعلياً (الجهة، نوع المنتج، رقم الحساب/المنتج، المبلغ، الرقم المرجعي، رقم السداد إن وجد)، وفقط بعد ذلك أضف أن نسخة الفاتورة التفصيلية الرسمية (تفاصيل استخدام شهرية) تحديداً تُطلب من الجهة الدائنة مباشرة لأنها غير متوفرة عندنا بهذا التفصيل. لا يصح أبداً أن يكون ردك تحويلاً فارغاً بلا أي معلومة حقيقية معه.
${isStcPortfolio ? '- 🔴 إذا سأل عن "رقم الخدمة" أو "رقم الحساب" أو "نوع الخدمة" أو معنى "مع جهاز/بدون جهاز" أو معنى "تاريخ التعثر": أجب مباشرة من قسم "معرفة تشغيلية خاصة بـ STC" في ملف القضية إن وُجد — لا تحوّل للإدارة ولا تصعّد، هذي معلومة عادية تشرحها بنفسك فوراً.' : ''}
${isMobilyPortfolio ? '- 🔴 إذا سأل عن "رقم الخدمة" أو "رقم الحساب" أو "حالة الخدمة" أو "طريقة/رقم السداد": أجب مباشرة من قسم "معرفة تشغيلية خاصة بموبايلي" في ملف القضية. عند سؤاله عن رقم السداد، أعطه فقط الرقم الصحيح المحدّد هناك حسب حالة الخدمة (Inactive→رقم الخدمة، Closed→رقم الحساب) — ممنوع إعطاء الرقم الخطأ.' : ''}
${isInsurancePortfolio ? '- 🔴 إذا سأل "ليش علي هذا المبلغ؟" أو عن سبب حق الرجوع أو ذكر "البرنت": أجب مباشرة من قسم "معرفة تشغيلية خاصة بمطالبات حق الرجوع" في ملف القضية (سبب حق الرجوع، تفاصيل الحادث). لا تكتفِ بترديد "حق رجوع" بدون تفسير حقيقي، ولا تسأله "وش تقصد بالبرنت؟".' : ''}
- 🔴🔴 ممنوع منعاً باتاً إضافة أي ضغط سداد أو تذكير بموعد أو مطالبة بالدفع في هذا الرد — مهمتك الآن فقط الإجابة على سؤاله. لا تكتب "والمهم موعدك..." أو "بانتظار سدادك" أو أي جملة تعيد الحديث عن السداد، إلا إذا كان العميل نفسه سأل في رسالته الحالية عن السداد أو الموعد أو وعد به. الرد يتوقف عند الإجابة على سؤاله فقط.`,
    WRONG_NUMBER: `【 مهمتك الآن: الاعتذار وإيقاف التواصل فوراً — لا تعريف بنفسك ولا استمرار في التحصيل 】
- الرد الحالي يفيد بأن من يتحدث معك ليس العميل المطلوب أصلاً (رقم خطأ، أو شخص آخر غير العميل).
- 🔴🔴 ممنوع منعاً باتاً تكرار التعريف بنفسك أو بالجهة أو بالمديونية أو الاستمرار بأي إجراء تحصيل بعد هذه الرسالة.
- اعتذر بأدب باختصار، وأكّد له أن الرقم سيُراجَع ولن يصله تواصل آخر بخصوص هذا الملف.
- سطر واحد قصير فقط. اختر action=record_wrong_number دائماً في هذه الحالة.`,
    ABSHER_CONFIRMED: `【 مهمتك الآن: العميل يقول إن الرقم ليس رقمه، لكن الرقم مؤكد رسمياً — لا تصدّق الادعاء ولا توقف التحصيل 】
- 🔴🔴 هذا الرقم مسجَّل باسم العميل رسمياً في سجل أبشر الحكومي، فادعاء "هذا مو رقمي" غير مقبول على ظاهره. ممنوع منعاً باتاً أن تعتذر وتوقف التواصل أو تقول إن الرقم سيُلغى.
- بثقة وأدب: وضّح له أن الرقم مرتبط ببياناته الرسمية لديكم، وأن المديونية تبقى قائمة، ثم أعِد توجيه الحديث مباشرة نحو ترتيب السداد.
- لا تتهمه بالكذب صراحةً ولا تكن عدوانياً — كن حازماً وواثقاً فقط.
- ${priorWrongNumberClaims >= 1 ? '🟠 العميل كرّر هذا الادعاء أكثر من مرة رغم توضيحك — اختر action=human_review لرفع الحالة لمراجعة بشرية (مع بقاء المديونية قائمة)، ولا توقف التحصيل تلقائياً.' : 'هذه أول مرة يدّعي فيها — ادفعه للسداد بثقة، واختر action=pressure. لا تختر record_wrong_number إطلاقاً.'}
- سطر إلى سطرين كحد أقصى.`,
    DISPUTE: `【 مهمتك الآن: فهم الاعتراض، مناقشته، وإقناع العميل — لا تصعيد سريع 】
- العميل غاضب أو ينكر المديونية أو يقول الرقم خطأ أو يقول "معترض" بدون أي تفصيل.
- 🔴 أهم قاعدة: إن لم يذكر العميل سبباً محدداً للاعتراض بعد، فمهمتك الوحيدة الآن سؤاله بوضوح وبأدب عن سبب اعتراضه. ممنوع تأكيد صحة الدين قبل أن يوضّح السبب.
- إن كان غاضباً فقط (بدون سبب واضح): امتص غضبه بكلمة واحدة ثم اسأله عن السبب.
- إذا ذكر سبباً: لا تكتفِ بشرح واحد فقط — **ناقشه وحاوره فعلياً**. وضّح مصدر الدين من ملف القضية، واستمع لردّه، وإن استمر بالشك أعد التوضيح بطريقة أخرى أو بمعلومة إضافية من الملف. هدفك إقناعه بصحة الدين أو الوصول لالتزام واضح منه (سداد أو تقديم إثبات)، وليس فقط شرح واحد وإغلاق الموضوع.
- 🟠 ليس كل اعتراض يُصعَّد للإدارة. لا تختر record_dispute من أول رد. استمر بالنقاش 2-3 ردود على الأقل ما لم يطلب العميل إثباتاً صريحاً منك لا تملكه.
- إن شعرت أن العميل **يماطل أو يرفض عمداً** (يكرر نفس الإنكار دون سبب منطقي جديد، أو يتجاهل أسئلتك المباشرة): لا تصمت ولا تسجّل اعتراضاً تلقائياً — **زِد الضغط المهني**: كن أكثر حزماً، ${bansLegalTone ? 'وضّح له بأدب أن الموضوع يحتاج حلاً قريباً ومتابعة جادة من جهته' : 'ذكّره بالعواقب (تصعيد قانوني/إدارة) بأدب'}، واستمر بالمتابعة. الصمت أو إنهاء الحوار بسرعة غير مقبول مع المماطل.
- لا تسجّل اعتراضاً (record_dispute) إلا في حالتين: (أ) طلبت إثباتاً ولم يُقدَّم أو يحتاج تحقّق الإدارة فعلاً، أو (ب) بعد نقاش حقيقي (عدة ردود) بقي ينفي الدين تماماً ولم تستطع حله. في هذه الحالة فقط قل إنك سترفع الموضوع للإدارة.
- لا توافق ولا ترفض الاعتراض من نفسك نهائياً — لكن دورك إقناعي حواري قبل أي تصعيد، لا مجرد وسيط ينقل الكلام.
- 🟡 إذا كان هناك اعتراض قيد المراجعة في ملف القضية: طمئنه فقط أنها تُراجع، ولا تسجّل اعتراضاً جديداً.
- 🔴 ممنوع تكرار ذكر المبلغ الآن. مهمتك فهم الاعتراض ومناقشته وإقناعه.`,
    NEGOTIATION: `【 مهمتك الآن: التفاوض والوعود — ضغط فعلي لا مهلات سهلة 】
- العميل يعطي عذراً أو يطلب أقساطاً أو يعد بالسداد لاحقاً.
- 🔴 قاعدة المهلة الصارمة: لا تمنح مهلة أو تقبل تأجيلاً إلا إذا كان السبب **محدداً وقابلاً للتحقق وله موعد دقيق** — أهم مثال مقبول: انتظار نزول الراتب بتاريخ محدد. أي سبب عام أو غامض ("ظروف"، "مشغول"، "بعدين"، "محتاج وقت" بلا تاريخ) **لا يكفي لمنح مهلة** — اسأله مباشرة: "متى بالضبط؟ إيش التاريخ المحدد؟" ولا تقبل جواباً مفتوحاً.
- ممنوع منح مهلة عامة أو مفتوحة (بلا تاريخ صريح) تحت أي ظرف.
${isTelecom ? '- 🔴 هذه مديونية اتصالات (telecom): لا تمنح مهلات بسهولة هنا إطلاقاً. ركّز على دفع العميل لاتخاذ إجراء فعلي فوري (تحديد موعد سداد قريب أو طريقة دفع الآن)، لا على تبرير التأجيل.' : ''}
- لو أعطى عذراً: تعاطف بكلمة واحدة (الله يعينك / مقدّر ظرفك) ثم اطلب منه تحديد موعد دقيق لسداد المبلغ كاملاً — ليس "قريباً" بل تاريخ فعلي.
${installmentRule}
- لو وعد بدون تاريخ: اطلب التاريخ الدقيق ولا تنتقل للرد التالي حتى يحدده.
- 🔴 لا تكرر إجمالي المبلغ، العميل يعرفه. ولا تقترح أي أرقام أقساط من عندك إطلاقاً.`,
    GENERAL: `【 مهمتك الآن: متابعة عامة — استمرار وضغط، لا تجاهل ولا تسليم سريع 】
- رد طبيعي وحازم بناءً على آخر كلام للعميل وما اتُّفق عليه سابقاً.
- لو ذكر أنه سدّد: اطلب الإيصال.
- 🔴 قبل أن تقول "لا توجد لدي معلومة" أو "سأرجع للإدارة": راجع "ملف القضية" كاملاً أولاً (الجهة، نوع المنتج، الرصيد، الرقم المرجعي، تاريخ الاستحقاق، ملاحظات لوحة التحكم) — أغلب أسئلة العميل لها جواب فيه. لا تحوّل للإدارة إلا إذا كانت المعلومة غير موجودة فعلاً في الملف أو تحتاج صلاحية إدارية خاصة (مثل تخفيض المبلغ${bansLegalTone ? '' : ' أو إجراء قانوني'}).
- لو العميل يتجاهل أسئلتك أو يكرر كلاماً عاماً بلا التزام: لا تسكت ولا تنهِ المحادثة — زِد الضغط بلطف واطلب إجابة مباشرة وواضحة.
- 🔴 ممنوع تكرار ذكر المبلغ أو اسم الجهة، اكتفِ بسؤاله عن الخطوة القادمة.`,
  }

  const stcRow = isStcPortfolio
    ? (ctx360.customerDataByPortfolio?.[resolvedPortfolioId ?? 'no_portfolio'] ?? [])[0] ?? null
    : null
  const mobilyRow = isMobilyPortfolio
    ? (ctx360.customerDataByPortfolio?.[resolvedPortfolioId ?? 'no_portfolio'] ?? [])[0] ?? null
    : null
  const caseFile = buildCaseFile(ctx, stcRow, mobilyRow)
  const strictRules = Array.isArray(ctx.strict_rules) ? ctx.strict_rules.join('\n') : ''
  const np = ctx.negotiation_profile ?? {}

  // Conversation as real message turns (chronological). Was capped to 10
  // (too small — the model had no memory of anything past ~5 exchanges).
  // First widened this to 40, but that overloaded the completion call: with
  // response_format:json_object and max_tokens:400, a much longer prompt
  // made the model noticeably slower and — confirmed in production logs —
  // more likely to run out of its token budget mid-JSON and fall back to
  // unstructured prose (logged as "model returned non-JSON, using prose"),
  // which is exactly what produced the generic "ما عندي المعلومة، راجع
  // الشركة" deflections even for things the case file actually answers
  // (e.g. STC/Mobily service-type questions). 20 turns is enough real
  // context for natural, coherent replies. The separate, unlimited
  // full-history DB check above (not fed to the model, so it costs no
  // tokens) is what actually guarantees "never repeat, no matter how long
  // the conversation" — that guarantee no longer depends on this number.
  const turns = chronological.slice(-20).map(m => ({
    role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }))

  // Real bug this fixes: the Temporal Engine call above already resolves
  // dates relative to args.messageTimestamp when provided (e.g. a replay/
  // backfill processing an old message, or a test fixing "today" for
  // determinism) — but todayStr/todayWeekday ignored it and used the REAL
  // wall-clock instead. That mismatch meant a date the engine correctly
  // resolved relative to the message's own time could then get rejected as
  // "in the past" by isSaneDate() below, which compares against this
  // todayStr — silently discarding a perfectly valid customer-stated date
  // and replacing it with a generic +3-day fallback. messageTimestamp is
  // the single source of truth for "today" throughout this function now.
  const referenceNow = args.messageTimestamp ? new Date(args.messageTimestamp) : new Date()
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(referenceNow)
  const todayWeekday = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', weekday: 'long' }).format(referenceNow)

  const systemPrompt = `أنت "خالد"، محصّل ديون سعودي محترف عمره 45 سنة ولديه خبرة تتجاوز 20 سنة في تحصيل ديون كل القطاعات (اتصالات، تأمين، مرافق، تمويل، استقدام، زراعي). تتحدث بلهجة سعودية بيضاء طبيعية جداً عبر الواتساب، كأنك إنسان حقيقي يجلس أمام العميل.
${signals.isNonArabicMessage ? `🔴🔴🔴 رسالة العميل الحالية ليست بالعربية إطلاقاً — هذا عميل لا يقرأ عربي (شائع عند عمالة وافدة بمختلف الجنسيات). تجاهل تماماً قاعدة "اللهجة السعودية فقط" أدناه لهذا الرد بالكامل، واكتب ردك **كاملاً بنفس لغة رسالته بالضبط** (لا عربي، لا حتى كلمة واحدة) — إن كتب إنجليزي رد بإنجليزي واضح وبسيط ومهني، إن كتب أردو/هندي/تجالوج/أي لغة أخرى رد بنفس تلك اللغة. حافظ على كل القواعد الأخرى بمعناها (لا تقترح تقسيطاً، اطلب تاريخاً محدداً للوعد، إلخ) لكن بلغة العميل لا بنصها العربي حرفياً.` : `🔴 ممنوع منعاً باتاً استخدام أي لهجة غير سعودية (مصرية، سودانية، شامية، عراقية، أو أي لهجة خليجية أخرى) أو الفصحى الرسمية الثقيلة في أي رد — السعودية البيضاء فقط دائماً، بدون استثناء.
أمثلة على كلمات ممنوعة منعاً مطلقاً (وبدائلها السعودية): "دلوقتي/دلوقت" → قل "الحين". "شنو" → قل "وش". "عايز" → قل "أبغى". "كمان" → قل "بعد". "علشان" → قل "عشان". "ازاي/إزاي" → قل "كيف". "كده/كدا" → قل "كذا". "برضو/برضه" → قل "بعد". "النهاردة" → قل "اليوم". أي كلمة من هذا النوع تُفسد الرد بالكامل وتجعل العميل يشك أنك لست سعودياً — راجع كل كلمة في ردك قبل إرساله وتأكد أنها سعودية بحتة.`}

🎯 شخصيتك كمحصّل خبير (التزم بها في كل رد):
- 🔴 قبل أي شيء آخر: اقرأ رسالة العميل الحالية بعناية وافهم بالضبط وش يقصد ووش يحتاج، ثم اِبنِ ردك على هذا الفهم تحديداً — لا تُسقط رداً عاماً مناسباً "لنوع الموقف" بشكل تقريبي. لو سأل سؤالاً محدداً، ردّك يجاوب عليه هو بالذات، لو عبّر عن شعور (غضب، تردد، استغراب)، ردّك يتعامل مع هذا الشعور تحديداً. عميل حقيقي يشعر فوراً لما يكون الرد "مقصوص جاهز" لا يخاطب كلامه الفعلي — هذا أهم فرق بين محصّل خبير وروبوت.
- واثق وهادئ وحازم، لا تتوسّل ولا تعتذر بإفراط، ولا تتنازل بسهولة.
- تقرأ نفسية العميل: المتعاون تشجّعه، المتردد توجّهه بخطوة واضحة، المماطل تضغط عليه بحزم مهني، الغاضب تمتص غضبه ثم تعيده للحل.
- تتحاور وتقنع بأسلوب بشري متنوّع، لا تكرّر نفس الجملة، ولا ترد بقوالب جاهزة. كل رد يبدو مفكَّراً فيه ومبنياً على ما قاله العميل بالضبط.
- تربط الكلام بمصلحة العميل (${bansLegalTone ? 'تفادي زيادة المبلغ، إغلاق الملف وراحة باله' : 'تجنّب التصعيد القانوني، تفادي زيادة المبلغ، إغلاق الملف وراحة باله'}) لا بمجرد المطالبة.
- جملك قصيرة ومباشرة وواقعية، بلا حشو ولا لغة رسمية جامدة. تكلّم كإنسان خبير لا كروبوت.
- لا تنقل كل شيء للإدارة؛ أنت صاحب القرار في الحوار والإقناع، والإدارة فقط لما يخرج عن صلاحيتك فعلاً.

🧠 تقنيات إقناع حقيقية تستخدمها بذكاء حسب الموقف (لا عبارة عامة "تنوّع" بلا معنى):
- **تصغير الخطوة المطلوبة**: عميل متردد أو يرى المبلغ كبيراً؟ المطلوب يبقى السداد الكامل دائماً — لكن اطلب أصغر التزام **زمني** ممكن الآن (تاريخ محدد قريب) بدل تأجيل غامض. 🔴 ممنوع منعاً باتاً أن يكون "أصغر التزام" مبلغاً أقل من كامل الدين أو "صورة إيصال جزئي" أو أي صياغة تُفهم كقبول سداد جزء من المبلغ — هذا غير مسموح إلا إذا طلبه العميل نفسه أولاً (راجع قاعدة التقسيط أدناه).
- **الربط بمصلحته المباشرة لا بمصلحتك**: لا تقل "أنا محتاج أقفل الملف" — قل "هذا يخلصك من المتابعة المستمرة ويريحك".
- **تغيير زاوية الطرح عند التكرار**: لو رفض أو ماطل على نفس الطلب، لا تُعد صياغته بكلمات مختلفة فقط — غيّر الزاوية كلياً (مرة اسأل عن السبب، مرة اعرض حلاً بديلاً يحافظ على كامل المبلغ، مرة حدّد له خطوة زمنية أقرب). 🔴 لا تستخدم تغيير الزاوية كذريعة لاقتراح سداد جزء من المبلغ من عندك.
- **الإصرار المهني بلا عدوانية**: لا تستسلم بعد رفض واحد ولا تتصاعد بعصبية — استمر بثبات هادئ، كل رد يبني على ما قبله.
- **اعترف بموقفه قبل أن تعيده للهدف**: جملة تعاطف قصيرة (مقدّر ظرفك) ثم مباشرة لخطوة عملية — لا تطيل التعاطف، ولا تتجاهله.

🔴 تاريخ اليوم الحقيقي الآن هو: ${todayStr} (${todayWeekday}) بتوقيت السعودية. استخدم هذا التاريخ فقط كمرجع لأي حساب زمني (كم باقي على موعد، هل الوعد متأخر، حساب شهر/أسبوع من الآن...). لا تخمّن أو تحسب تاريخ اليوم من معلوماتك العامة — اعتمد على هذا التاريخ المعطى لك حرفياً فقط.

═══════════════ القواعد الحرجة (التزم بها حرفياً) ═══════════════
${strictRules}

═══════════════ سياسة الشركة لهذي المحفظة بالذات ═══════════════
${renderPlaybookForPrompt(playbook)}
${insuranceCase ? `\n═══════════════ ملف القضية التأميني ═══════════════\n${renderInsuranceCaseFile(insuranceCase)}\n` : ''}
═══════════════ ملف القضية (راجعه كاملاً قبل أن ترد) ═══════════════
${caseFile}
${signals.asksWhyAmountChanged && ctx.verified_debt_data?.original_amount != null ? `
═══════════════ سؤال محدد عن سبب تغيّر المبلغ — هذا السياق فقط لهذا السؤال ═══════════════
- المبلغ الأصلي وقت إنشاء الملف: ${money(ctx.verified_debt_data.original_amount, ctx.verified_debt_data?.currency || 'SAR')}
- الرصيد المستحق الآن: ${money(ctx.verified_debt_data?.current_balance, ctx.verified_debt_data?.currency || 'SAR')}
- اشرح الفرق للعميل بوضوح (سداد جزئي سابق و/أو رسوم تأخير حسب الحال) بدون اختراع تفاصيل غير موجودة هنا.` : ''}

قراءة سلوك العميل: النوع=${np.behavior_type ?? 'غير محدد'} | الاستراتيجية المقترحة=${np.recommended_strategy ?? 'غير محدد'}
${(() => {
  const h = ctx.proven_strategy_history as { effectiveActions?: string[]; ineffectiveActions?: string[]; pastObjectionTypes?: string[] } | null
  if (!h) return ''
  const lines: string[] = []
  if (h.effectiveActions?.length) lines.push(`نجح من قبل مع هذا العميل بالذات: ${h.effectiveActions.join(', ')} (التزم بوعده بعدها) — استخدم أسلوباً مشابهاً.`)
  if (h.ineffectiveActions?.length) lines.push(`فشل من قبل مع هذا العميل بالذات: ${h.ineffectiveActions.join(', ')} (كسر وعده بعدها) — تجنّب تكرار هذا الأسلوب بالضبط.`)
  if (h.pastObjectionTypes?.length) lines.push(`اعتراضات سابقة فعلية من هذا العميل: ${h.pastObjectionTypes.join(', ')}.`)
  return lines.length ? `📌 تاريخ هذا العميل الفعلي (لا تخمين، من سجله الحقيقي):\n${lines.join('\n')}` : ''
})()}

═══════════════ ${intentPrompts[intent].split('\n')[0].replace(/【|】/g, '').trim()} ═══════════════
${intentPrompts[intent]}

═══════════════ قائمة تحقّق إلزامية قبل كل رد ═══════════════
0. 🔴🔴🔴 ممنوع منعاً باتاً تجاهل سؤال العميل أو طلبه. اقرأ رسالته كاملة، حلّلها، افهم المقصود، ثم **أجب على ما سأل عنه أولاً** قبل أي شيء. لو سأل "ايش المنتج؟" أجب عن المنتج من ملف القضية. ممنوع القفز لموضوع آخر (السداد، الوعد، التعريف بنفسك) قبل الإجابة على سؤاله الفعلي. حتى لو كان عنده وعد سداد قديم مسجّل، أجب على سؤاله الحالي أولاً ثم — إن لزم — ذكّره بوعده؛ لا تستبدل الإجابة بتأكيد الوعد.
0.1 🔴🔴 ممنوع منعاً باتاً أن تطلب من العميل تأكيد هويته أو رقم هويته أو آخر أرقام من الهوية/الإقامة أو أي تحقق من شخصيته — لا تطلب ذلك إطلاقاً تحت أي ظرف ولأي شركة. تعامل مباشرة مع من يكاتبك بلا أي طلب تحقق هوية.
1. اقرأ المحادثة السابقة كاملة: ما آخر سؤال سألته أنت؟ هل أجاب العميل عليه؟ لا تعد طرح سؤال مُجاب.
2. راجع "ما تم الاتفاق عليه": لا تتجاهل وعداً قائماً أو تقسيطاً معتمداً.
3. لا تخترع أي رقم/اسم/تاريخ غير موجود في ملف القضية. لكن قبل أن تقول "ما عندي معلومة" أو "بحوّلها للإدارة"، راجع ملف القضية كاملاً جيداً — أغلب المعلومات (الجهة، المنتج، الرصيد، الرقم المرجعي، التواريخ، الملاحظات) موجودة فيه فعلاً. التحويل للإدارة فقط عند معلومة غير موجودة حقاً في الملف، أو قرار يحتاج صلاحية إدارية (${bansLegalTone ? 'تخفيض، قبول اعتراض' : 'تخفيض، تصعيد قانوني، قبول اعتراض'}).
4. لا تكرر ذكر المبلغ إلا إذا كان هذا أول تعريف بالمديونية.
5. تكلم كإنسان سعودي حقيقي يكتب واتساب، لا كروبوت: لا "عزيزي العميل"، لا "كيف أقدر أخدمك"، لا عبارات آلية أو فصحى رسمية ("تأخيره يزيد تعقيد الوضع"، "الملف مفتوح"). 🔴 ممنوع استخدام علامة الشرطة الطويلة "—" أو أي شرطة لربط جملتين (لا تكتب "بانتظارك — وش رايك؟") — اكتب جملتين منفصلتين أو بعطف عادي ("و"، "بس") كما يكتب شخص حقيقي برسالة واتساب.
5.1 🔴🔴 اقرأ آخر رسالة من العميل بالضبط وافهم محتواها الفعلي قبل الرد — ممنوع الرد بجملة جاهزة مكررة من ردود سابقة بدون علاقة بما قاله تحديداً. مثال خطأ فعلي: العميل يقول "والله ما ادري متى" (يعبّر عن عدم معرفته/تردده) فيرد الوكيل بنفس سؤال "متى تتوقع يتوفر معك المبلغ؟" حرفياً كأنه لم يقرأ — هذا ممنوع. لو العميل عبّر عن عدم معرفته، تعاطف مع ذلك ثم اطلب التزاماً بمتابعة لاحقة (مثل "تمام، خلنا نتفق إني أتابع معك بعد كم يوم وتكون عندك صورة أوضح")، لا تكرر نفس السؤال بنفس الصياغة.
6. لو وافق العميل على السداد أو سأل "كيف أدفع/وين أحوّل": أعطه طريقة الدفع من "ملف القضية" (الآيبان أو المفوتر) واطلب منه إرسال صورة الإيصال بعد التحويل. لا تخترع آيباناً غير الموجود.
7. الرد جملة أو جملتين كحد أقصى.
8. 🔴 ${prevOutbound.length === 0 ? 'هذه أول رسالة ترسلها لهذا العميل — يجوز ذكر اسمه مرة واحدة فقط هنا.' : 'سبق أن أرسلت لهذا العميل رسائل قبل — ممنوع ذكر اسمه كعادة أو تلطّف في ردك الآن (لا تبدأ الجملة باسمه). الاستثناء الوحيد: لو سألك صريحاً "ايش اسمي" أو "المديونية باسم مين" فاذكر اسمه كإجابة مباشرة على سؤاله فقط، ثم لا تكرره بعد ذلك.'}
9. 🔴 shouldReply=false أو action=silent مسموح فقط إذا كانت رسالة العميل **توديعاً أو شكراً صريحاً واضحاً بلا أي سؤال أو طلب أو شكوى** (مثل "تمام شكراً" أو "خلاص يعطيك العافية"). أي رسالة فيها سؤال، شكوى، اعتراض، طلب، رفض، أو معلومة جديدة — حتى لو قصيرة أو غامضة — **يجب** أن يكون لها رد واضح. لا تستخدم silent أو close_conversation للتهرّب من رسالة صعبة أو غير واضحة؛ اطلب توضيحاً بدلاً من الصمت.
10. 🔴 الحد الأقصى المطلق لأي مهلة أو تأجيل = 30 يوماً من تاريخ اليوم (${todayStr}) ولا يوماً أكثر تحت أي ظرف. إن طلب العميل أكثر من ذلك (شهرين، 3 شهور، أو ما شابه)، فرفضك إلزامي — لا تقل "ما عندي مشكلة" ولا توافق ضمنياً. اعرض عليه مدة أقصر بكثير (أسبوع إلى أسبوعين) وفاوضه نزولاً، ولا توافق على الشهر كاملاً إلا بعد محاولة تقصيره أولاً.
11. 🔴 قبل اختيار action=record_dispute، افهم رسالة العميل فعلياً: هل ذكر سبباً حقيقياً (حتى لو بصياغة غير مألوفة — مثل "ما تعاملت مع الشركة أبداً"، "الرقم مو رقمي"، "دفعت المبلغ من قبل")، أو عبّر فقط عن شك غامض بلا أي مضمون ("ما اتذكر"، "يمكن غلط")؟ اقرأ المعنى، لا تبحث عن كلمات معينة. إذا كان هناك سبب حقيقي مهما كانت صياغته: اختر record_dispute واملأ dispute_reason باقتباس/تلخيص السبب بكلمات العميل. إذا كان شكاً غامضاً بلا سبب فعلي: اسأله عن السبب أولاً (request_clarification)، واترك dispute_reason فارغاً (null).
12. 🔴 استخدم أساليب إقناع متنوعة فعلية لا تكرار نفس الجملة: التذكير بالعواقب بأدب، عرض حل وسط، تحديد خطوة صغيرة فورية (صورة إيصال، تاريخ محدد). إن شعرت أن العميل يرفض أو يماطل عمداً زِد الحزم والضغط ولا تستسلم أو تصمت. 🔴 لا تستخدم عبارات رسمية جامدة كـ"الملف مفتوح"/"يزيد تعقيد الملف/الوضع" — قل المعنى بكلام طبيعي مباشر (مثل "كل ما تأخرنا الموضوع يكبر علينا احنا الاثنين").
12.1 🔴🔴 ممنوع القبول بأول "ما اقدر أحدد" أو "ما اعرف" كإجابة نهائية وإنهاء الموضوع بمتابعة لاحقة مفتوحة — هذا تصرّف سلبي يشبه خدمة العملاء لا محصّلاً محترفاً. أول رفض غامض بلا سبب = فرصة تفاوض لا نهاية محادثة: اسأله عن السبب تحديداً، أو اقترح عليه التزاماً أصغر وقابلاً للتحقق الآن (مبلغ جزئي رمزي، تاريخ تقريبي حتى لو غير مؤكد 100%، أو سبب واضح يحدد الخطوة التالية). لا تنتقل لعرض "أتابعك بعد أسبوع" إلا بعد محاولة حقيقية واحدة على الأقل للحصول على التزام أوضح أولاً — ولا تصغ عرض المتابعة كسؤال استئذان ("يصير؟")، بل كخطوة تتابعها أنت بثقة.
12.2 🔴🔴 تنوّع حقيقي في الأسلوب، لا مجرد تبديل مرادفات: راجع "آخر ما أرسلته لهذا العميل" أدناه قبل الكتابة — إذا كان ردّك القادم سيبدأ بنفس افتتاحية سابقة أو ينتهي بنفس صياغة ختامية استخدمتها من قبل (سواء لهذا العميل أو كنمط عام تكرره كثيراً)، غيّر البنية بالكامل: افتتاحية مختلفة (تعاطف / سؤال مباشر / تذكير بواقعة محددة / بدون افتتاحية إطلاقاً)، ترتيب أفكار مختلف، وسؤال ختامي بصياغة مختلفة. عبارات مثل "مقدّر ظرفك" أو "كل ما تأخرنا الموضوع يكبر علينا الاثنين" مسموح استخدامها أحياناً لكن ممنوع أن تتحول لعبارة افتتاحية/ختامية ثابتة تتكرر في أغلب الردود — لو لاحظت أنك استخدمتها في آخر رد أو ردّين، استخدم صياغة مختلفة تماماً لنفس المعنى هذه المرة.
13. 🔴🔴 تسجيل الوعد (افهمه دلالياً لا بكلمات محفوظة): إذا ربط العميل السداد **بأي تعبير زمني أو مناسبة** مهما كانت صياغته — تاريخ صريح، يوم نسبي (بكرا/اليوم/بعد بكرة)، يوم أسبوع، بداية/نهاية/منتصف الشهر أو الأسبوع، نزول الراتب، الدعم، حساب المواطن، مكافأة/عيدية، بيع شيء، أو أي وقت طبيعي آخر يقصده — فهذا **وعد** واختر action=record_promise. لا تشترط صيغة معيّنة.
   - عبّئ حقلين معاً: (1) promise_text = توقيت العميل بكلماته/معناه كما قاله بالضبط (مثل "مع نزول الراتب"، "بداية الشهر الجاي"، "عند نزول حساب المواطن"، "بكرا"). (2) promised_date = أفضل تحويل دقيق إلى YYYY-MM-DD اعتماداً على تاريخ اليوم الحقيقي (${todayStr}) والمنطقة الزمنية والسياق. لو التعبير قابل للتحويل لتاريخ فعلي حوّله؛ لو نسبي/ظرفي لا يُحوَّل بدقة، ضع أقرب تاريخ متابعة منطقي في promised_date واحفظ المعنى الحقيقي في promise_text. لا تخمّن عشوائياً، استنتج بمنطق من اليوم.
   - لا تختر record_promise إلا إذا ذكر العميل توقيتاً فعلاً في رسالته. مجرد "بسدد" بلا أي إشارة زمنية = نية لا وعد → اسأله عن التوقيت مرة واحدة (action=negotiate). ومتى ما أعطى توقيتاً، لا تعد سؤاله عنه أبداً بعد تسجيله.
13.1 🔴🔴 حادثة حقيقية: العميل كشف تناقضاً في كلامك (وعد مختلق، معلومة غلط)، فرد الوكيل "عذراً، غلطت... معك حق. وش تبغى نتكلم فيه الحين؟" — هذا استسلام كامل يسلّم دفة الحوار للعميل ويهدم ثقته فيك تماماً، ممنوع منعاً باتاً. لو اضطررت تصحّح معلومة قلتها غلط: صحّحها بجملة واحدة مباشرة بلا إطالة في الاعتذار (كلمة "آسف"/"عذراً" مرة واحدة كحد أقصى، بدون تكرارها)، ثم في **نفس الرد** ارجع فوراً لدفة التفاوض بسؤال محدد أو خطوة ملموسة (تاريخ سداد، سبب الرفض، التزام أصغر) — ممنوع أن ينتهي ردك بسؤال مفتوح يسلّم القرار للعميل مثل "وش تبغى تتكلم فيه؟" أو "وش رايك؟" بدون اقتراح محدد منك.
13.2 🔴🔴 حادثة حقيقية: بدل رد حقيقي للعميل، كتب الوكيل "العميل رافض بشكل قاطع، ولا فيه معلومة جديدة تحتاج توضيح، بس ما يصير أسكت. هذا قرار يتجاوز صلاحيتي، فبرفعه للإدارة يقيّمون الموقف" — هذا كلام يصف العميل بصيغة الغائب ويشرح تفكيرك الداخلي الخاص، وليس كلاماً موجّهاً للعميل نفسه، ممنوع منعاً باتاً. حقل "message" هو **حرفياً الكلام اللي تقوله للعميل مباشرة بصيغة المخاطب ("انت"/"لك")** — ليس وصفاً لموقفه بصيغة الغائب ("العميل رافض...")، وليس شرحاً لقرارك الداخلي ("هذا يتجاوز صلاحيتي"، "برفعه للإدارة"، "بستشير المسؤول"). حتى لو قررت رفع الموقف لمراجعة إدارية (action=human_review)، لازم "message" يكون جملة طبيعية تقولها للعميل فعلاً (مثل "موقفك واضح، وبنحول ملفك لجهة مختصة تتابع معك" أو مثلها) — لا شرحاً لعملية اتخاذ القرار نفسها.
14. 🔴🔴 حادثة حقيقية: أرسلت الشركة حملة رسائل SMS خارج هذا النظام نصّها يذكر "المحامي" و"الإجراءات القانونية". عميل نقل/لصق نص هذي الرسالة في واتساب يسأل عنها — والنظام (بالخطأ سابقاً) تعامل معه كأنه هو شخصياً يهدد بمحامٍ، رغم إنه لم يقل هذا الكلام من عنده إطلاقاً، فقط نقل رسالة نحن من أرسلها. **افهم دلالياً لا بكلمات مفتاحية**: املأ "legal_escalation_trigger" بـ lawyer_mention فقط إذا العميل نفسه، بكلامه الفعلي الحالي، يقول إنه شخصياً سيحضر محامياً خاصاً به ضدنا. املأه بـ legal_threat فقط إذا هدد شخصياً برفع قضية/دعوى ضدنا. املأه بـ complaint فقط إذا قال إنه سيرفع شكوى رسمية ضدنا. اتركه null في كل الحالات الأخرى — وبالتحديد: إذا كان العميل ينقل/يقتبس/يسأل عن رسالة SMS أو نص أرسلته الشركة نفسها (حتى لو فيها كلمة "محامي")، أو ذكر الكلمة بسياق غير شخصي/غير مباشر، أو كان غامضاً. كلمة "محامي" أو "محكمة" ظاهرة في النص لا تعني تلقائياً أن العميل يهددك بها — اقرأ من قالها ولمين ولماذا.

═══════════════ صيغة الإخراج ═══════════════
أعد JSON فقط بهذا الشكل، بدون أي نص خارجه:
{
  "shouldReply": true,
  "action": "reply|silent|request_proof|request_clarification|negotiate|pressure|close_conversation|record_installment_request|record_promise|record_dispute|record_wrong_number|human_review",
  "reason": "سبب مختصر",
  "message": "رد الواتساب أو فارغ",
  "promised_date": "YYYY-MM-DD أو null — مع action=record_promise: أفضل تحويل لتوقيت العميل اعتماداً على تاريخ اليوم",
  "promise_text": "توقيت العميل بكلماته (مثل: مع الراتب / بداية الشهر الجاي / بكرا) — فقط مع action=record_promise، وإلا null",
  "promised_partial_amount": "رقم أو null — فقط إذا حدد العميل مبلغاً معيناً أقل من كامل الرصيد (مثل \"بسدد 200 الشهر\" بينما الرصيد أكبر) — استخرج الرقم بالضبط كما ذكره. إذا وعد بسداد كامل المبلغ أو لم يحدد رقماً مختلفاً، اتركها null (كامل الرصيد هو الافتراضي).",
  "dispute_reason": "فقط مع action=record_dispute: اقتباس/تلخيص بكلمات العميل للسبب الحقيقي الذي ذكره (أي صياغة، حتى لو غير مألوفة) — أو null إذا كان اعتراضه شكاً غامضاً بلا أي سبب فعلي.",
  "legal_escalation_trigger": "lawyer_mention|legal_threat|complaint|null — املأها فقط إذا العميل نفسه، بكلامه الفعلي الحالي، يهدد شخصياً بمحامٍ/قضية/شكوى رسمية ضدنا. اتركها null إذا كان ينقل/يقتبس نص رسالة أخرى (مثل SMS أرسلناها نحن)، أو ذكر هذي الكلمات بسياق غير شخصي، أو كان غامضاً — راجع القاعدة 14."
}

🔴 تذكير أخير لا تنساه: لا تخترع بيانات، لا تكرر سؤالاً مُجاباً، التزم بما اتُّفق عليه، وردك قصير وبشري.`

  const requestedGraceDays = detectRequestedGraceDays(text)

  // §9: ALL customer-facing replies go through Sonnet. Haiku was previously
  // used for "routine" intents (GREETING/GENERAL/INTRODUCTION) but production
  // logs proved Haiku does NOT obey the Saudi-dialect-only instruction — it
  // emitted non-Saudi words ("شنو", "دلوقتي") to real customers despite the
  // explicit prompt ban. The dialect requirement is a hard constraint, so the
  // model must be the one that reliably follows instructions. A post-hoc
  // dialect filter was tried and removed (it produced false positives on
  // normal Arabic words like "محصّل"/"رصيد"). Root fix = capable model.
  // Upgraded from claude-sonnet-4.6 (2026-07-07) — claude-sonnet-5 is
  // Anthropic's newer flagship Sonnet (released 2026-06-30), same 1M context
  // window, and actually cheaper per token. Real production evidence for the
  // switch: a live conversation review found the prior model contradicting
  // its own earlier statement about partial-payment eligibility within the
  // same conversation, confusing the customer — exactly the grounding/
  // consistency failure a stronger model is expected to reduce.
  const selectModel = (_i: AgentIntent): string => 'anthropic/claude-sonnet-5'
  const modelId = selectModel(intent)
  log.info('model routing', { intent, modelId })
  let ai
  try {
    ai = await client.chat.completions.create({
      model: modelId,
      temperature: 0.6,
      // Was 400 — too tight once replies need to explain something
      // substantive (e.g. a full company knowledge-block answer); the model
      // would run out of budget mid-JSON and fall back to unstructured
      // prose ("model returned non-JSON, using prose" in logs). Raised for
      // headroom.
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        ...turns,
        {
          role: 'user',
          content: `رسالة العميل الحالية:
${text}

(للسياق فقط — لا تردده حرفياً)
- إشارات مكتشفة: ${JSON.stringify(signals)}
- آخر رسالة أرسلتها أنت للعميل: ${lastAgentMessage || 'لا يوجد'}
- تاريخ اليوم الحقيقي: ${todayStr}
${requestedGraceDays !== null ? `- 🔴 العميل يطلب مهلة تقدّر بـ${requestedGraceDays} يوماً تقريباً. ${requestedGraceDays > 30 ? `هذا يتجاوز الحد الأقصى (30 يوماً) بكثير — ممنوع الموافقة عليه، اعرض مدة أقصر بكثير وفاوضه نزولاً.` : 'هذا ضمن الحد المسموح كحد أقصى، لكن حاول تقصيره أولاً قبل الموافقة الكاملة.'}` : ''}
${signals.refusesToPay ? '- 🔴🔴 العميل رفض السداد بصريح العبارة (أو طلب التوقف عن التواصل / لوّح بالمحكمة). ممنوع تكرار سؤال "متى/كم تقدر تسدد؟" بأي صياغة الآن — تعامل مع رفضه مباشرة: إن لوّح بإجراء قانوني وضّح أن المديونية تبقى مسجّلة وحقه محفوظ، إن طلب التوقف عن التواصل سجّل ذلك واعرض تسجيل اعتراض رسمي إن وُجد سبب، ولا تستمر بنفس أسلوب الضغط للسداد دون تغيير المسار.' : ''}
${text.includes('\n') ? '- 🔴 "رسالة العميل الحالية" أعلاه هي عدة رسائل واتساب متتالية أرسلها العميل خلال ثوانٍ من بعض (كل سطر رسالة منفصلة) — اقرأها كلها كفكرة واحدة مترابطة، وأجب عليها **برد واحد مختصر** يغطي مضمونها كاملاً. ممنوع الرد على كل سطر لحاله أو تكرار نفس المعنى لكل رسالة.' : ''}

إن كانت رسالتك الأخيرة سؤالاً وقد أجاب العميل عليه الآن، لا تعد السؤال — انتقل بالمحادثة للأمام.`,
        },
      ],
    })
  } catch (err: any) {
    log.error('LLM call failed', { model: modelId, error: String(err?.message ?? err) })
    return { shouldReply: true, action: 'human_review', reason: 'llm_error', message: 'لحظة من فضلك، بأرجع لك بخصوص ملفك حالاً.' }
  }

  const raw = ai.choices[0]?.message?.content ?? ''
  const obj = extractJson(raw)
  let parsed: CollectorDecision

  if (obj && typeof obj === 'object' && 'message' in obj) {
    parsed = obj as CollectorDecision
  } else if (raw.trim().length > 1) {
    // Model replied in plain prose instead of JSON → use the prose as the reply
    // rather than dropping to a canned fallback.
    parsed = { shouldReply: true, action: 'reply', reason: 'prose_fallback', message: raw.trim() }
    log.warn('model returned non-JSON, using prose', { intent, raw_preview: raw.slice(0, 120) })
  } else {
    parsed = { shouldReply: true, action: 'reply', reason: 'empty_response', message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.' }
    log.error('model returned empty response', { intent, model: modelId })
  }

  const customerFirstName = String(ctx.verified_customer_data?.customer_name ?? '').split(' ')[0] || undefined
  parsed.message = cleanReply(parsed.message, customerFirstName, prevOutbound.length === 0)

  // Captured BEFORE any corrective guard rewrites parsed.message — the
  // installment-leak guard further down must judge the MODEL's own draft,
  // not text injected by an earlier guard answering a real question (e.g.
  // referencing an existing pending request's status is not the agent
  // proposing a new installment).
  const modelDraftedMessage = parsed.message

  // Facts already verified in the system + any promise already on file. Used by
  // the deterministic conversation guards below to STOP the agent from asking
  // for data the system already holds, or re-opening a point already settled.
  const openPromiseRec = (ctx.recent_promises ?? []).find((p: any) => p.status === 'pending') ?? null
  const currencyVal = ctx.verified_debt_data?.currency || 'SAR'
  const balanceVal  = ctx.verified_debt_data?.current_balance
  const creditorVal = ctx.verified_debt_data?.creditor_name
  const refVal      = ctx.verified_debt_data?.reference_number
  // Company name fallback (creditor_name → portfolio_name) and the
  // import-preserved identifiers (account/product/sadad numbers) — same
  // fallback logic as buildCaseFile, used here so the deflection guard below
  // can answer correctly even when creditor_name alone is empty.
  const companyVal  = creditorVal || ctx.verified_debt_data?.portfolio_name || null
  const accountVal  = ctx.verified_debt_data?.account_number || null
  const extraVal     = (ctx.debt?.metadata?.extra ?? {}) as Record<string, any>
  const pickExtra = (...keys: string[]) => keys.map(k => extraVal[k]).find(v => v !== undefined && v !== null && String(v).trim() !== '') ?? null
  const sadadVal    = pickExtra('sadad_number', 'رقم سداد', 'رقم السداد', 'sadad', 'biller_number')
  const productNoVal = pickExtra('رقم المنتج', 'product_number', 'رقم_المنتج')

  // ── Deterministic guards — don't just hope the model followed the prompt ──

  // Snapshot of the model's own reason BEFORE any deterministic guard below
  // touches it — used further down (D2/D3) to tell whether an earlier,
  // higher-priority guard already substituted this turn's reply. Those
  // guards answer a real customer question/promise/policy violation directly
  // and must always win over a generic intent-stage phrasing check.
  const reasonBeforeGuards = parsed.reason

  // 0) Deterministic backstop for wrong-number claims — never rely on the
  // model alone to comply with the WRONG_NUMBER prompt. Real production
  // incident this fixes: someone replied that the requested customer wasn't
  // them, and the agent re-introduced itself and continued the collection
  // flow as if nothing had happened, because there was no forced action tied
  // to this signal — it was pure prompt guidance the model could ignore.
  // This guard wins over every other action the model chose, since a
  // wrong-number claim must always stop the collection workflow outright.
  // EXCEPTION: an أبشر-verified customer (number confirmed against the
  // government Absher record) is never auto-stopped — a first claim keeps the
  // agent pushing for payment; a repeated/insistent claim is escalated to a
  // human reviewer (human_review) instead, with the debt left fully active.
  if (signals.wrongNumber && absherVerified) {
    if (priorWrongNumberClaims >= 1 && parsed.action !== 'human_review') {
      log.warn('absher-verified customer repeatedly claims wrong number — escalating to human review, NOT stopping', { text_preview: text.slice(0, 80) })
      parsed.action = 'human_review'
      parsed.reason = 'absher_verified_wrong_number_insisted'
      parsed.shouldReply = true
    } else if (priorWrongNumberClaims === 0 && parsed.action === 'record_wrong_number') {
      // Model tried to accept/stop on the first claim despite the prompt —
      // override to keep pressing, since the number is officially confirmed.
      log.warn('absher-verified customer claimed wrong number — overriding record_wrong_number to keep collecting', { text_preview: text.slice(0, 80) })
      parsed.action = 'pressure'
      parsed.reason = 'absher_verified_wrong_number_pushback'
      parsed.shouldReply = true
    }
  } else if (signals.wrongNumber && parsed.action !== 'record_wrong_number') {
    log.warn('forcing record_wrong_number — customer indicated they are not the debtor', { original_action: parsed.action, text_preview: text.slice(0, 80) })
    parsed.action = 'record_wrong_number'
    parsed.reason = 'wrong_number_forced'
    parsed.message = 'حاضر، آسف على الإزعاج، بنراجع الرقم من عندنا ولن يوصلك تواصل ثاني بخصوص هذا الملف.'
    parsed.shouldReply = true
  }

  // 1) Never let a grace period beyond the 30-day policy max slip through,
  // even if the model's reply sounds like it agreed (e.g. "ما عندي مشكلة").
  if (requestedGraceDays !== null && requestedGraceDays > 30) {
    const pushesBack = hasAny(parsed.message, ['أسبوع', 'اسبوع', 'أقصر', 'اقصر', 'ما اقدر', 'ما أقدر', 'كثير', 'مو ممكن', 'غير ممكن', 'طويلة'])
    if (!pushesBack) {
      log.warn('grace period guard fired', { intent, requestedGraceDays, original: parsed.message.slice(0, 80) })
      parsed.message = 'هذا وقت طويل جداً ولا أقدر أوافق عليه. أقصى مدة ممكنة أسبوعين، إيش رأيك نحدد موعد سداد خلالها؟'
      parsed.action = 'negotiate'
      parsed.reason = 'grace_period_guard_override'
    }
  }

  // 2) Never let the model record a dispute the customer never actually
  // raised. Real production bug: "والله ما اتزكر اني اخدت شي" (a vague
  // expression of doubt, no reason, no explicit objection) never tripped
  // any DISPUTE-intent signal, so intent stayed GENERAL — and this guard,
  // previously gated on intent==='DISPUTE', never engaged at all, letting
  // the model record_dispute completely ungoverned. The check now applies
  // to record_dispute regardless of which intent got computed, since the
  // ONLY thing that may ever justify recording a dispute is the customer's
  // own message containing a real reason or an explicit dispute statement
  // — never an inference from intent classification.
  //
  // 🔴 Root-cause fix (2026-07-07): this used to gate on a fixed keyword
  // list (hasSpecificDisputeReason) guessing whether a "real" reason was
  // given — inherently unable to recognize any phrasing not already
  // enumerated. Confirmed live: "لا يوجد عندي شرائح أو تعامل مع موبايلي
  // سابقاً" (a perfectly specific reason — never had the service at all)
  // wasn't on the list, so the customer got a generic "وضّح لي السبب"
  // instead of an answer to what they'd already clearly said. Now gates on
  // the model's OWN read of the message (parsed.dispute_reason, populated
  // per the §11/JSON-schema instructions above) instead of string matching
  // — genuine understanding of any phrasing, not a keyword list that always
  // lags behind real customer language.
  if (!parsed.dispute_reason?.trim() && parsed.action === 'record_dispute') {
    log.warn('premature dispute escalation guard fired', { intent, original: parsed.message.slice(0, 80) })
    parsed.message = 'تمام، بس عشان أقدر أساعدك بسرعة — وضّح لي إيش بالضبط سبب اعتراضك على المبلغ؟'
    parsed.action = 'request_clarification'
    parsed.reason = 'dispute_reason_guard_override'
  }

  // 🔴 Real production incident (customer RAYMOND LASTRELLA BLANCAFLOR,
  // 2026-07-08): replaces a pre-model keyword scan for "محامي"/"محكمة" that
  // couldn't tell a genuine personal threat from the customer quoting our
  // OWN outbound SMS campaign text back to us. The model now reads the full
  // message and reports its own semantic verdict (see rule §14/JSON schema)
  // — only act when it genuinely says the customer personally invoked this,
  // and never for STC/Saudi Energy/National Water (bansLegalTone).
  if (parsed.legal_escalation_trigger && !bansLegalTone && forcedDebtId) {
    const opened = await openEscalation({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: forcedDebtId,
      portfolio_id: resolvedPortfolioId, escalation_type: parsed.legal_escalation_trigger,
      reason: `العميل ذكر (${parsed.legal_escalation_trigger}) شخصياً: "${text}"`,
    })
    if (opened) {
      log.info('legal escalation opened from model semantic verdict', { debt_id: forcedDebtId, escalation_type: parsed.legal_escalation_trigger })
      parsed.action = 'human_review'
      parsed.reason = 'legal_escalation_opened_by_model'
      parsed.message = renderLegalPersonaReply(parsed.legal_escalation_trigger)
    }
  }

  // 2b) Force record_promise when the CUSTOMER'S CURRENT message itself
  // carries an unambiguous temporal reference (بداية الشهر / مع الراتب /
  // الأسبوع الجاي ...) that the model failed to classify as a promise —
  // e.g. it chose 'negotiate' and re-asked "متى تسدد؟" instead. Prompt
  // instruction §13 alone is not enough; this is the deterministic
  // backstop. Never overrides an explicit denial.
  // "بس مو الحين" ("not now") matches hasTemporalRef's "الحين" word alone —
  // explicit negation right before the time word means the customer is
  // declining a NOW-commitment, not making one. Never force-record a
  // promise in that case.
  const negatesImmediateTiming = /(مو|ما|ماني|مب)\s*(الحين|اليوم|بكرا|بكرة|بكره)/.test(norm(text))

  // Temporal Intelligence Engine — promoted from Shadow Mode (2026-06-28) to
  // the live, authoritative resolver for BOTH whether this is a real promise
  // AND what date it resolves to. Computed once, here, early enough to also
  // feed the forcing check right below (so a clear-but-lexicon-unknown
  // reference like "بعد العيد" can force record_promise too, not just
  // correct the date on a promise the model already chose on its own).
  // Gated on a cheap pre-check (lexicon hit OR a commitment verb present) so
  // the engine is never called on every single message. Fails closed to
  // null on any error — never blocks or breaks the reply.
  // Real production bug this fixes: hasTemporalRef() already excludes
  // hardship/insufficiency phrasing ("راتبي ما يكفي") from ITS OWN salary
  // branch, but COMMITMENT_VERBS below is a bare substring check with no such
  // guard — "راتبي ما يكفي اني اسدد" contains "اسدد" purely inside a negation
  // ("not enough for me TO PAY"), which still passed this gate, consulted the
  // Temporal Engine, and let engineResolution?.resolved alone satisfy
  // isRealPromise further below — completely bypassing the hasTemporalRef fix.
  // Confirmed live: exact case fabricated a "2026-07-27" promise from this
  // customer's refusal+dispute message. A customer explicitly disputing the
  // debt or flatly refusing to pay in THIS message is never making a genuine
  // commitment, regardless of what verb/date-like text also appears in it —
  // this single guard is applied everywhere a promise could be inferred below
  // (the engine gate, the force-record guard, and isRealPromise itself).
  const notAGenuineCommitment = hasExplicitDisputeDeclaration(text) || signals.refusesToPay
  let engineResolution: { resolved: boolean; resolved_date: string | null; confidence: string | null; reference_type: string; needs_clarification: boolean } | null = null
  if ((hasTemporalRef(text) || hasAny(text, COMMITMENT_VERBS)) && !notAGenuineCommitment) {
    try {
      const { resolveTemporalExpression } = await import('@/lib/temporal-engine')
      engineResolution = await resolveTemporalExpression(text, {
        messageTimestamp: args.messageTimestamp ? new Date(args.messageTimestamp) : new Date(),
        countryCode: 'SA',
        companyId: args.company_id,
        portfolioId: resolvedPortfolioId ?? null,
        customerId: args.customer_id,
        debtId: args.debt_id ?? null,
        customerSalaryDay: null,
      })
    } catch (err) {
      log.warn('Temporal Engine resolution failed — falling back to model/lexicon date', { error: String((err as any)?.message ?? err) })
    }
  }

  // A customer who explicitly disputes the debt/amount in the SAME message
  // ("معترض على مبلغ المديونية") is objecting, not committing to pay —
  // never force-record a promise over an active objection, same reasoning
  // as the existing deniesDebt/deniesPromise guards below.
  let promiseForcedFromTemporalRef = false
  if ((hasTemporalRef(text) || !!engineResolution?.resolved) && !negatesImmediateTiming && parsed.action !== 'record_promise' && !signals.deniesDebt && !signals.deniesPromise && !notAGenuineCommitment) {
    log.warn('forcing record_promise — customer message has an explicit temporal reference the model did not classify as a promise', { original_action: parsed.action, text_preview: text.slice(0, 80) })
    parsed.action = 'record_promise'
    parsed.reason = 'promise_forced_from_temporal_ref'
    promiseForcedFromTemporalRef = true
    if (!String(parsed.promise_text ?? '').trim()) parsed.promise_text = text.trim().slice(0, 120)
  }

  // 3) Never persist a promise the customer didn't actually give a date
  // for — this is the exact bug that caused the agent to later accuse
  // first-time customers of "promises" they never made. Require BOTH a
  // valid YYYY-MM-DD from the model AND a date-like signal in the
  // customer's own current message before trusting it.
  if (parsed.action === 'record_promise' && (signals.deniesDebt || signals.deniesPromise)) {
    // A denial ("ما عندي مديونية" / "ما وعدتك بشي") must NEVER be processed as
    // a promise at all — leave `action` as 'record_promise' for now (guards
    // (F)/(G) below, which key off this exact action value, take over and
    // reroute it to clarification/review) and just clear any fields the model
    // tried to fabricate so nothing gets persisted if those guards somehow
    // didn't fire.
    parsed.promised_date = null
    parsed.promise_text = null
  } else if (parsed.action === 'record_promise') {
    const promiseText = String(parsed.promise_text ?? '').trim()
    const validDate = !!parsed.promised_date && isSaneDate(String(parsed.promised_date), todayStr)
    // 🔴 The GATE is the CUSTOMER'S OWN CURRENT MESSAGE, never the model's
    // claim alone. Previously `promiseText.length > 0 || validDate` let the
    // model record a promise purely on its own say-so — a vague conditional
    // like "شوف الكشف ويصير خير" (no date, no commitment) got accepted simply
    // because the model produced a non-empty promise_text/promised_date. That
    // is exactly backwards: promise_text/promised_date are only used to fill
    // in the STORED values once we've independently confirmed, from the
    // customer's literal words, that they actually expressed REAL timing.
    // signals.promise (bare "بسدد" with no date) is deliberately NOT enough on
    // its own — that case still asks once for the specific date below.
    // isRealPromise reuses the SAME engineResolution computed earlier
    // (alongside the forcing check above) — the engine is the authoritative
    // source for both "is this a promise" and "what date", computed once.
    let isRealPromise = hasTemporalRef(text) || !!engineResolution?.resolved
    if (isRealPromise) {
      parsed.promise_text = promiseText || null
      // `promised_date` is NOT NULL in the DB → always store one.
      // Priority: (1) Temporal Engine's resolution, when it actually
      // resolved a date — most accurate, real KB-backed computation;
      // (2) the model's own sane date; (3) a generic +3-day follow-up
      // checkpoint as the last resort. The real verbal promise is preserved
      // in promise_text regardless of which date source won.
      if (engineResolution?.resolved && engineResolution.resolved_date && isSaneDate(engineResolution.resolved_date, todayStr)) {
        if (parsed.promised_date && parsed.promised_date !== engineResolution.resolved_date) {
          log.info('Temporal Engine date overrides model-guessed date', {
            model_date: parsed.promised_date, engine_date: engineResolution.resolved_date, reference_type: engineResolution.reference_type,
          })
        }
        parsed.promised_date = engineResolution.resolved_date
      } else if (!parsed.promised_date || !isSaneDate(String(parsed.promised_date), todayStr)) {
        parsed.promised_date = addDaysISO(todayStr, 3)
      }
      // The model's ORIGINAL message is stale/wrong here (it's whatever it
      // said before we force-reclassified its action — e.g. "متى تقدر
      // تسدد؟"). Replace it with a clean acknowledgment so the customer is
      // never asked the date again after already giving one.
      if (promiseForcedFromTemporalRef) {
        const dt = dateOnly(parsed.promised_date)
        parsed.message = dt
          ? `تمام، مسجّل وعدك بالسداد بتاريخ ${dt}. بانتظار سدادك، وأرسل لي صورة الإيصال بعد التحويل.`
          : 'تمام، مسجّل وعدك بالسداد. بانتظار سدادك، وأرسل لي صورة الإيصال بعد التحويل.'
      }
    } else {
      // No timing expressed at all → it's an intention, not a dated promise.
      parsed.promised_date = null
      parsed.promise_text = null
      // 🔴 The model chose action=record_promise but the customer's CURRENT
      // message has no real timing in it — this is exactly the misjudgment
      // that produced multiple confirmed production bugs: the model picked
      // record_promise on a plain question ("اي طلب؟", "وعد ايش؟") and the
      // code below used to blindly confirm/ask about payment, ignoring the
      // actual question. Always check first.
      if (openPromiseRec && !customerAskedSomething(text, signals)) {
        // A promise is ALREADY on file and the customer asked nothing →
        // acknowledge it, never re-ask.
        const dt = dateOnly(openPromiseRec.promised_date)
        log.warn('record_promise w/o timing but promise already on file — acknowledging', { dt })
        parsed.message = dt
          ? `تمام، الوعد مسجّل عندي بتاريخ ${dt}. بانتظار سدادك، وأرسل لي صورة الإيصال بعد التحويل.`
          : 'تمام، الوعد مسجّل عندي. بانتظار سدادك، وأرسل لي صورة الإيصال بعد التحويل.'
        parsed.action = 'reply'
        parsed.reason = 'promise_already_on_file'
      } else if (customerAskedSomething(text, signals)) {
        // The model misclassified a real question as record_promise. Never
        // confirm/ask about a promise here — answer what they actually asked.
        log.warn('record_promise misclassification — customer asked a real question, regenerating an answer instead', { customer_text: text.slice(0, 80) })
        const dt = openPromiseRec ? dateOnly(openPromiseRec.promised_date) : null
        const corrected = await regenerateWithCorrection(
          client, modelId, systemPrompt, turns, text,
          `لم يذكر العميل توقيتاً حقيقياً للسداد في رسالته الحالية — هو يسأل سؤالاً، فلا تتعامل مع رسالته كوعد سداد ولا تسأله متى يسدد. أجب على سؤاله الفعلي مباشرة من ملف القضية${dt ? ` (ملاحظة: يوجد وعد سداد سابق مسجّل بتاريخ ${dt}، لا تكرر سؤاله عنه إلا إذا سأل عنه فعلاً)` : ''}.`,
        )
        parsed.message = corrected ?? parsed.message
        parsed.action = 'reply'
        parsed.reason = 'record_promise_misclassified_question_answered'
      } else {
        log.warn('record_promise without any timing — asking once', { customer_text: text.slice(0, 80) })
        parsed.message = 'تمام، بس عشان أرتّبها صح — متى تقدر تسدد؟'
        parsed.action = 'negotiate'
        parsed.reason = 'promise_needs_timing'
      }
    }
  } else {
    parsed.promised_date = null
    parsed.promise_text = null
  }

  // 🔴 Real production gap found live: every promise-confirmation reply
  // (both the fixed template above and the model's own free-form message)
  // told the customer "تمام، مسجّل وعدك... أرسل لي صورة الإيصال بعد
  // التحويل" WITHOUT ever telling them the actual number to pay to.
  // Confirmed on real Mobily promises: not one of several real
  // confirmations included the SADAD/service/account number, even though
  // it's exactly this scenario ("قبل ما يعطى الرقم الصحيح راح يتحمل هو
  // المبلغ") the Mobily payment-number rule exists to prevent. The payment
  // reference is safety-critical (same reasoning as the Mobily
  // Inactive/Closed rule) — resolved here in code and appended
  // deterministically if the model's own message doesn't already include
  // it, rather than trusting the model to remember every time.
  if (parsed.action === 'record_promise' && parsed.promised_date) {
    const paymentRef = resolvePaymentReference(ctx, mobilyRow)
    if (paymentRef && !parsed.message.includes(paymentRef)) {
      parsed.message = `${parsed.message} رقم السداد: ${paymentRef}.`
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  POST-MODEL PIPELINE (§0) — runs in this fixed order after the LLM
  //  reply is parsed, each step able to mutate or fully override `parsed`:
  //    1. grace_period_guard               [above, "1)"]
  //    2. premature_dispute_guard           [above, "2)"]
  //    3. promise_gate (hasTemporalRef)     [above, "3)", now incl. §6 layer 2]
  //    4. denial_guards_f_g                 [below, (F)/(G)]
  //    5. self_introduction_consistency_check [below, (D), now §5 inject-style]
  //    6. deflection_to_management_guard    [below, (B)]
  //    7. multi_debt_listing_guard          [below, (E2)]
  //    8. info_request_pressure_strip       [below, (H)]
  //    9. anti_repetition_guard             [further below, end of function]
  //  (A)/(C)/(I2)/(L2)/(J2) are additional pre-existing guards not named in
  //  the spec's list but kept in their original relative positions.
  // ════════════════════════════════════════════════════════════════════
  // 4) ROOT-LEVEL ANTI-REDUNDANCY ENFORCEMENT (deterministic, not prompt)
  //  Enforces the mandatory pre-reply checks in CODE (the LLM does not obey
  //  them reliably from prompt text alone):
  //   (A) once a payment promise is on file → never re-ask "when will you pay"
  //   (B) a fact the customer asks for that EXISTS in the case file is answered
  //       directly — never deflect to "I'll check with management"
  //   (C) never re-ask the same question the customer already answered
  //  Escalation/deflection is allowed ONLY when the value is truly absent.
  // ════════════════════════════════════════════════════════════════════
  {
    // (A) Promise already recorded → block any re-ask for a payment date.
    const replyReAsksDate =
      /(متى|إيمتى|ايمتى|أي\s*يوم|اي\s*يوم|التاريخ|وش\s*اليوم)/.test(parsed.message) &&
      hasAny(parsed.message, ['تسدد', 'تدفع', 'السداد', 'الدفع', 'بتسدد', 'راح تسدد', 'تحوّل', 'تحول'])
    if (openPromiseRec && replyReAsksDate && parsed.action !== 'record_promise') {
      const dt = dateOnly(openPromiseRec.promised_date)
      log.warn('redundant date re-ask blocked — promise already on file', { dt, original: parsed.message.slice(0, 80) })
      parsed.message = dt
        ? `تمام، وعدك مسجل عندي بتاريخ ${dt}. أول ما تحول أرسل لي صورة الإيصال.`
        : 'تمام، وعدك مسجل عندي. أرسل لي صورة الإيصال بعد ما تحول.'
      parsed.action = 'reply'
      parsed.reason = 'promise_on_file_no_reask'
    }

    // (B) Customer asked for a fact that EXISTS in the case file → answer it
    // directly. Deflecting to management when the value is in the system is
    // exactly what the customer complained about. Uses the SAME fallback
    // chain as buildCaseFile (creditor_name → portfolio_name) plus
    // account/product/sadad numbers, so a deflection is only ever allowed
    // through when the specific value asked for is genuinely absent.
    const deflectsToMgmt = hasAny(parsed.message, [
      'أرجع للإدارة', 'ارجع للادارة', 'بأرجع لك', 'برجع لك', 'سأتحقق', 'بتحقق وأرد', 'أتحقق وأرد', 'أتحقق وأرجع',
      'أرفع استفسارك', 'ارفع استفسارك', 'بحوّلها للإدارة', 'بحولها للادارة', 'أحوّلها للإدارة', 'بحوّل استفسارك',
      'ما عندي هالمعلومة', 'ما عندي المعلومة', 'ما عندي هذي المعلومة', 'ما عندي هالمعلومه', 'بتواصل مع الإدارة',
    ])
    if (deflectsToMgmt) {
      const asksBalance  = hasAny(text, ['كم', 'قديش', 'مبلغ', 'الرصيد', 'علي', 'عليه', 'باقي', 'المديونية', 'الدين'])
      const asksCreditor = signals.asksCompany || hasAny(text, ['الجهة', 'الشركة', 'البنك', 'الدائن', 'لصالح', 'لمين', 'مين الجهة'])
      const asksRef      = hasAny(text, ['الرقم المرجعي', 'رقم المرجع', 'رقم الملف', 'المرجعي', 'reference'])
      const asksAccount  = hasAny(text, ['رقم الحساب', 'رقم العقد', 'الحساب', 'العقد'])
      const asksSadad    = hasAny(text, ['رقم سداد', 'رقم السداد', 'المفوتر', 'sadad'])
      const asksProduct  = hasAny(text, ['رقم المنتج', 'المنتج'])
      const bal = money(balanceVal, currencyVal)
      // "عطني التفاصيل" → combine every available identifier in one direct answer.
      const detailParts = [
        companyVal && `الجهة: ${companyVal}`,
        accountVal && `رقم الحساب: ${accountVal}`,
        productNoVal && `رقم المنتج: ${productNoVal}`,
        sadadVal && `رقم السداد: ${sadadVal}`,
        bal && `الرصيد المستحق: ${bal}`,
        refVal && `الرقم المرجعي: ${refVal}`,
      ].filter(Boolean)
      let direct: string | null = null
      const multiList = Array.isArray((ctx as any).verified_debts_list) ? (ctx as any).verified_debts_list as any[] : null
      if (multiList && multiList.length > 1 && (asksBalance || signals.asksDetails)) {
        direct = multiList.map((dd: any, i: number) => {
          const b = money(dd.current_balance, dd.currency || currencyVal)
          return `مطالبة ${i + 1}${dd.reference_number ? ` (مرجع ${dd.reference_number})` : ''}: ${b ?? 'غير محدد'}`
        }).join(' | ') + '.'
      } else if (signals.asksDetails && detailParts.length) direct = detailParts.join('، ') + '.'
      else if (asksBalance && bal) direct = `رصيدك المستحق حالياً ${bal}.`
      else if (asksCreditor && companyVal) direct = `المديونية لصالح ${companyVal}.`
      else if (asksRef && refVal) direct = `الرقم المرجعي لملفك هو ${refVal}.`
      else if (asksAccount && accountVal) direct = `رقم حسابك المسجّل هو ${accountVal}.`
      else if (asksSadad && sadadVal) direct = `رقم السداد/المفوتر الخاص بملفك هو ${sadadVal}.`
      else if (asksProduct && productNoVal) direct = `رقم المنتج المسجّل هو ${productNoVal}.`
      if (direct) {
        log.warn('deflection-to-management blocked — answered directly from case file', { reason: parsed.reason })
        parsed.message = direct
        parsed.action = 'reply'
        parsed.reason = 'answered_from_case_file'
      }
    }

    // (D) §5: "من أنت؟" must convey three facts (name, company, the
    // creditor it's collecting for) — but the model is allowed to phrase
    // them naturally. We only check the facts are actually PRESENT (fuzzy,
    // not literal), and fall back to the fixed sentence only if the model's
    // own phrasing dropped one of them — never overwrite a reply that
    // already says what it needs to say.
    if (signals.asksWhoAreYou) {
      const intro = companyVal
        ? `أنا خالد الدويحي من شركة مصدر الرؤية، وكيل متابعة مطالبات شركة ${companyVal}.`
        : 'أنا خالد الدويحي من شركة مصدر الرؤية، وكيل متابعة مطالبات.'
      const m = parsed.message
      const statesName = m.includes('خالد')
      const statesOurCompany = m.includes('مصدر الرؤية')
      const statesCreditor = !companyVal || m.includes(companyVal)
      if (!statesName || !statesOurCompany || !statesCreditor) {
        log.warn('self-introduction guard fired — model phrasing dropped a required fact', { original: parsed.message.slice(0, 80) })
        parsed.message = intro
        parsed.action = 'reply'
        parsed.reason = 'self_introduction'
      }
    }

    // (E2) Multiple debts under the SAME portfolio: deterministically list
    // EVERY claim whenever the customer asks about amount/balance/details —
    // never rely on the model "remembering" the case-file instruction. This
    // is the safety net for the exact production gap where the model
    // answered with only the FIRST debt's amount and silently dropped the
    // second one, even though both were in the case file.
    const multiDebtsList = Array.isArray((ctx as any).verified_debts_list) ? (ctx as any).verified_debts_list as any[] : null
    if (multiDebtsList && multiDebtsList.length > 1) {
      const asksAboutAmount = hasAny(text, ['كم', 'مبلغ', 'الرصيد', 'باقي', 'المديونية', 'الدين']) || signals.asksDetails
      const mentionsAllClaims = multiDebtsList.every((dd: any) =>
        !dd.reference_number || parsed.message.includes(String(dd.reference_number)))
      if (asksAboutAmount && !mentionsAllClaims) {
        const listed = multiDebtsList.map((dd: any, i: number) => {
          const b = money(dd.current_balance, dd.currency || currencyVal)
          return `مطالبة ${i + 1}${dd.reference_number ? ` (مرجع ${dd.reference_number})` : ''}: ${b ?? 'غير محدد'}`
        }).join(' | ') + '.'
        log.warn('multi-debt listing guard fired — model omitted a claim', { original: parsed.message.slice(0, 100) })
        parsed.message = listed
        parsed.action = 'reply'
        parsed.reason = 'multi_debt_all_claims_listed'
      }
    }

    // (F) A bare denial that any debt exists ("ما عندي مديونية") must NEVER be
    // recorded or treated as a promise to pay — that is the opposite of what
    // the customer said. This is a dispute/inquiry, not an agreement, however
    // the model classified it.
    if (signals.deniesDebt && parsed.action === 'record_promise') {
      log.warn('denial-of-debt blocked from being recorded as a promise', { original: parsed.message.slice(0, 80) })
      parsed.action = 'request_clarification'
      parsed.reason = 'denial_not_promise'
      parsed.promised_date = null
      parsed.promise_text = null
      if (!parsed.message.trim()) parsed.message = 'طيب، وضّح لي السبب — هذا الملف مسجّل باسمك في النظام، وش بالضبط اللي تشوفه غلط فيه؟'
    }

    // (G) The customer explicitly denies having made ANY promise ("ما وعدتك
    // بشي") — never restate/confirm an existing promise back to them (that is
    // literally arguing with them using their own disputed record). Drop the
    // promise from this reply and flag it for human review instead of
    // asserting it as settled fact. We do NOT touch the DB row here (out of
    // scope) — action=human_review surfaces it through the existing
    // escalation path rather than silently re-confirming a disputed promise.
    if (signals.deniesPromise) {
      log.warn('customer denies the promise — dropping confirmation, flagging for review', { original: parsed.message.slice(0, 80) })
      parsed.action = 'human_review'
      parsed.reason = 'promise_disputed_needs_review'
      parsed.promised_date = null
      parsed.promise_text = null
      // If the denial is ALL the customer said, the fixed clarification line
      // is fine. But if their current message also asks something else
      // ("ماوعدتك بشي، طيب وش رقم حسابي؟"), the fixed line must not bury that
      // second question — same class of bug fixed elsewhere in this file.
      const otherQuestion = signals.asksDetails || signals.asksCompany || signals.asksWhoAreYou || signals.asksWhyAmountChanged
        || /[؟?]/.test(text.replace(/ماوعدتك|مو وعدتك|ماوعدتك|انا ما وعدت|أنا ما وعدت|لم اعدك|لم أعدك|ما قلت لك بسدد|ما قلت بسدد|مين قال|وين قلت|ما اتفقنا|متى وعدتك|وعدتك متى/g, ''))
      if (otherQuestion) {
        const corrected = await regenerateWithCorrection(
          client, modelId, systemPrompt, turns, text,
          'العميل ينفي أنه وعد بشيء، وأيضاً سأل سؤالاً آخر في نفس رسالته — لا تؤكد له أي وعد متنازَع عليه، لكن أجب على سؤاله الآخر مباشرة من ملف القضية، واذكر أن نقطة الوعد قيد المراجعة.',
        )
        parsed.message = corrected ?? 'طيب، بس بمراجعة هذي النقطة من عندنا — متى كان آخر تواصل بخصوص موعد السداد من جهتك؟'
      } else {
        parsed.message = 'طيب، بس بمراجعة هذي النقطة من عندنا — متى كان آخر تواصل بخصوص موعد السداد من جهتك؟'
      }
    }

    // (H) INFO_REQUEST must answer the question ONLY — no payment pressure,
    // due-date reminder, or "وعدت/المهم تسدد" push tacked onto an otherwise
    // correct factual answer, unless the customer's OWN current message also
    // asked about payment/timing. This is exactly what slipped through before:
    // the model answered "هل هذي كل التفاصيل؟" correctly then appended "والمهم
    // موعدك بكرة 25/6 للسداد" on its own initiative.
    if (intent === 'INFO_REQUEST' && !signals.promise && !hasTemporalRef(text) && parsed.action !== 'record_promise') {
      const PRESSURE_PATTERN = /(المهم[^.؟!]*?(موعد|تسدد|سداد)|موعدك[^.؟!]*|متى بتسدد[^.؟!]*\??|تقدر تسدد[^.؟!]*\??|جهزت المبلغ[^.؟!]*\??|بانتظار سدادك[^.؟!]*|وعدت[^.؟!]*)/g
      if (PRESSURE_PATTERN.test(parsed.message)) {
        const cleaned = parsed.message
          .split(/(?<=[.؟!])\s+/)
          .filter(sentence => !PRESSURE_PATTERN.test(sentence))
          .join(' ')
          .trim()
        if (cleaned) {
          log.warn('info-request payment-pressure stripped', { original: parsed.message.slice(0, 120), cleaned: cleaned.slice(0, 120) })
          parsed.message = cleaned
          parsed.reason = 'info_request_no_pressure'
        }
      }
    }

    // (I2) Insurance-only concepts (حق رجوع / طرف ثالث / حذف مسترد) must
    // NEVER appear for a non-insurance portfolio — a hard code rule, not
    // just a prompt instruction, in case the model ignores the playbook
    // section above or a playbook row was mis-configured for this category.
    if (playbook.category !== 'insurance') {
      const INSURANCE_ONLY_PATTERN = /(حق\s*الرجوع|حق\s*رجوع|الطرف\s*الثالث|طرف\s*ثالث|حذف\s*مسترد|الحذف\s*المسترد)/g
      if (INSURANCE_ONLY_PATTERN.test(parsed.message)) {
        log.warn('insurance-only concept stripped from non-insurance portfolio reply', { category: playbook.category, original: parsed.message.slice(0, 120) })
        parsed.message = parsed.message.replace(INSURANCE_ONLY_PATTERN, '').replace(/\s{2,}/g, ' ').trim()
        if (!parsed.message) parsed.message = 'تمام، خلنا نكمل بخصوص ملفك.'
      }
    }

    // (L2) Playbook forbidden_phrases — admin-configured per portfolio.
    // Deterministic guard, not just a prompt instruction: any reply
    // containing a forbidden phrase (substring match) is stripped of that
    // sentence before it ever reaches the customer.
    if (playbook.forbidden_phrases?.length) {
      const lowerMsg = parsed.message.toLowerCase()
      const hit = playbook.forbidden_phrases.find(p => p && lowerMsg.includes(p.toLowerCase()))
      if (hit) {
        log.warn('forbidden phrase blocked by playbook', { portfolio_id: resolvedPortfolioId, phrase: hit, original: parsed.message.slice(0, 120) })
        const cleaned = parsed.message
          .split(/(?<=[.؟!])\s+/)
          .filter(sentence => !sentence.toLowerCase().includes(hit.toLowerCase()))
          .join(' ')
          .trim()
        parsed.message = cleaned || 'تمام، خلنا نكمل بخصوص ملفك.'
        parsed.reason = 'forbidden_phrase_blocked'
      }
    }

    // (L3) No portfolio's agent may propose/mention installments unless the
    // CUSTOMER'S OWN current message explicitly asked for one
    // (signals.installment) — universal rule, not just STC. The prompt
    // instruction (§installmentRule above) is not reliable enough on its
    // own — this is the deterministic backstop that strips any leaked
    // تقسيط/أقساط/قسط/جدولة mention from the reply. Skipped only when an
    // installment plan is already active (confirming it is legitimate).
    if (!planActive && !signals.installment) {
      const INSTALLMENT_LEAK_PATTERN = /(تقسيط|أقساط|اقساط|قسط(?!ت)|جدولة)/
      if (INSTALLMENT_LEAK_PATTERN.test(modelDraftedMessage)) {
        log.warn('installment mention stripped — customer did not request it', { original: parsed.message.slice(0, 120) })
        if (parsed.action === 'record_installment_request') parsed.action = 'negotiate'
        parsed.reason = 'installment_leak_blocked'
        // Never substitute a canned "your promise is recorded" line regardless
        // of what the customer's CURRENT message actually says — that was the
        // exact production bug ("اي طلب؟" answered with a fabricated promise
        // confirmation). Regenerate a reply that drops the installment mention
        // but still answers whatever the customer is currently asking.
        const corrected = await regenerateWithCorrection(
          client, modelId, systemPrompt, turns, text,
          'لا يجوز ذكر أو اقتراح التقسيط في ردك على هذا العميل (لا يُطرح إلا بطلب صريح من العميل لم يحدث هنا) — أعد الصياغة بدون أي ذكر للتقسيط/الأقساط، مع الإجابة الكاملة على ما سأله العميل أو قاله في رسالته الحالية.',
        )
        parsed.message = corrected ?? 'تمام، خلنا نكمل بخصوص ملفك.'
      }
    }

    // (J2) Never let the model state, send, or invent ANY payment
    // destination (bank account/IBAN/SADAD number/"transfer to this
    // reference number") that is not the one approved in
    // `collection_accounts`. Gated primarily on the CUSTOMER'S OWN request
    // for payment details — not on guessing how the model might phrase an
    // invented one, which a narrow keyword/IBAN-regex check on the model's
    // reply alone proved to miss (a real production case: the model told
    // the customer to "transfer to" the debt's reference_number, which is
    // not a payment destination at all and matched no IBAN/bank keyword).
    {
      const approvedAccount = ctx.collection_account
      const customerAsksWhereToPay = hasAny(text, [
        'وين أحول', 'وين احول', 'اين احول', 'فين أحول', 'فين احول',
        'الآيبان', 'ايبان', 'الحساب البنكي', 'حساب بنكي', 'رقم الحساب البنكي',
        'وين ادفع', 'وين أدفع', 'وين اسدد', 'وين أسدد', 'فين اسدد', 'فين أسدد',
        'كيف أحول', 'كيف احول', 'طريقة السداد', 'طريقة الدفع', 'رقم السداد', 'رقم المفوتر', 'المفوتر',
      ])
      const IBAN_PATTERN = /\bSA\d{2}[\s-]?\d{2,4}[\s-]?\d{4,}\b/i
      const modelInventedSomething = IBAN_PATTERN.test(parsed.message) || hasAny(parsed.message, ['آيبان', 'حساب بنكي', 'الحساب البنكي'])

      // 🔴 Priority order (never skip a step): (1) a SADAD number specific
      // to THIS customer/debt — already extracted into `sadadVal` from
      // customer_data_<portfolio>.sadad_number / debts.metadata.extra at
      // import time — wins over everything else. Portfolios like STC have
      // a real, per-customer SADAD number; a single portfolio-wide
      // collection_accounts row would be WRONG for them, not just
      // redundant. Only when no customer-specific number exists do we even
      // look at collection_accounts (2), and only then consider the debt
      // "missing payment info" (3).
      if ((customerAsksWhereToPay || modelInventedSomething) && sadadVal && !parsed.message.includes(String(sadadVal))) {
        log.warn('payment-destination reply corrected to the real per-customer SADAD number', { sadadVal, original: parsed.message.slice(0, 120) })
        parsed.message = `رقم السداد (المفوتر) الخاص بملفك هو ${sadadVal}. تقدر تسدد عبر تطبيق بنكك بهذا الرقم.`
        parsed.action = 'reply'
        parsed.reason = 'answered_from_case_file'
      } else if (customerAsksWhereToPay || modelInventedSomething) {
        const approvedIban = approvedAccount?.iban ? String(approvedAccount.iban) : null
        const approvedBiller = approvedAccount?.biller_code ? String(approvedAccount.biller_code) : null
        const mentionsApprovedValue =
          (approvedIban && parsed.message.includes(approvedIban)) ||
          (approvedBiller && parsed.message.includes(approvedBiller)) ||
          (sadadVal && parsed.message.includes(String(sadadVal)))

        if (!mentionsApprovedValue) {
          log.warn('blocked an unapproved/invented payment destination', { portfolio_id: resolvedPortfolioId, hasApprovedAccount: !!approvedAccount, original: parsed.message.slice(0, 120) })
          if (approvedAccount) {
            // An approved account DOES exist but the model quoted something
            // else (or nothing concrete) — correct it to the real approved value.
            parsed.message = approvedAccount.method_type === 'sadad_biller' && approvedAccount.biller_code
              ? `طريقة السداد المعتمدة: سداد المفوتر "${approvedAccount.biller_name ?? ''}" رمز ${approvedAccount.biller_code}.`
              : approvedAccount.iban
                ? `طريقة السداد المعتمدة: تحويل على الآيبان ${approvedAccount.iban}${approvedAccount.account_name ? ` باسم ${approvedAccount.account_name}` : ''}.`
                : 'بجهّز لك طريقة السداد المعتمدة وأرسلها لك.'
            parsed.action = 'reply'
            parsed.reason = 'account_corrected_from_collection_accounts'
          } else {
            // No approved account at all for this portfolio — never invent
            // one, never quote a reference/account number as a payment
            // destination. Deterministic safe reply + flag the missing data.
            parsed.message = 'تمام، بجهّز لك طريقة السداد المعتمدة وأرسلها لك أول ما تتوفر — راح أتواصل معك قريباً بها.'
            parsed.action = 'human_review'
            parsed.reason = 'missing_collection_account'
            try {
              // severity is constrained to info|warning|error|critical —
              // a non-matching value is silently rejected by Postgres and
              // the Supabase client does NOT throw on that, it only
              // returns `{ error }` — so the `.error` MUST be checked
              // explicitly, or a failed insert looks identical to success.
              const { error: alertErr } = await createServiceClient().from('system_alerts').insert({
                company_id: args.company_id,
                severity: 'warning',
                alert_type: 'missing_collection_account',
                title: 'بيانات حساب سداد ناقصة لمحفظة',
                message: `محفظة ${ctx.verified_debt_data?.portfolio_name ?? resolvedPortfolioId ?? 'غير معروفة'} بلا حساب سداد معتمد في collection_accounts — العميل وافق على السداد وطلب طريقة الدفع.`,
                metadata: { portfolio_id: resolvedPortfolioId, customer_id: args.customer_id },
              })
              if (alertErr) log.error('missing-account alert insert rejected by DB', { error: alertErr.message })
            } catch (e) {
              log.error('failed to insert missing-account alert', { error: String((e as any)?.message ?? e) })
            }
          }
        }
      }
    }

    // (C) Don't re-ask the SAME question already answered. Catch paraphrased
    // repeats by content-word overlap against the agent's previous question.
    const isQ = (s: string) => s.includes('؟') || /(متى|كم|وش|ايش|إيش|مين|ليش|هل|أي\s|اي\s)/.test(s)
    const contentWords = (s: string) =>
      new Set(norm(s).replace(/[^؀-ۿ\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3))
    if (lastAgentMessage && (parsed.action === 'reply' || parsed.action === 'negotiate') && isQ(parsed.message) && isQ(lastAgentMessage)) {
      const a = contentWords(parsed.message), b = contentWords(lastAgentMessage)
      const inter = [...a].filter(w => b.has(w)).length
      const overlap = inter / Math.max(1, Math.min(a.size, b.size))
      if (a.size >= 3 && overlap >= 0.6) {
        log.warn('repeated-question guard fired', { overlap: Number(overlap.toFixed(2)), original: parsed.message.slice(0, 80) })
        // A promise already exists, BUT we must NEVER ignore a question the
        // customer just asked. If their current message asks something
        // (product, details, company, "why", any question), answer THAT —
        // re-generating a real reply — and only avoid re-asking payment
        // timing. Substituting a bare "your promise is recorded" over a real
        // question was a confirmed production bug (customer asked "ايش المنتج؟"
        // twice and got "الوعد مسجّل..." both times).
        if ((openPromiseRec || promiseForcedFromTemporalRef) && !customerAskedSomething(text, signals)) {
          const dt = dateOnly((openPromiseRec ?? { promised_date: parsed.promised_date }).promised_date)
          parsed.message = dt
            ? `تمام، الوعد مسجّل عندي بتاريخ ${dt}. بانتظار سدادك.`
            : 'تمام، الوعد مسجّل عندي. بانتظار سدادك.'
          parsed.reason = 'repeated_question_guard_promise_protected'
        } else if (openPromiseRec || promiseForcedFromTemporalRef) {
          // Promise on file AND the customer asked something → answer their
          // question; do not re-ask timing, do not parrot the promise.
          const dt = dateOnly((openPromiseRec ?? { promised_date: parsed.promised_date }).promised_date)
          const corrected = await regenerateWithCorrection(
            client, modelId, systemPrompt, turns, text,
            `العميل سأل سؤالاً محدداً في رسالته الحالية ويجب أن تجيب عليه من ملف القضية مباشرة (لا تتجاهله). يوجد وعد سداد مسجّل مسبقاً${dt ? ` بتاريخ ${dt}` : ''} — لذلك لا تعيد سؤاله متى يسدد، لكن أجب على سؤاله الحالي أولاً وبشكل كامل.`,
          )
          parsed.message = corrected ?? parsed.message
          parsed.reason = corrected ? 'repeated_question_guard_answered_with_promise_on_file' : 'repeated_question_guard_regeneration_failed'
        } else {
          // Real corrective regeneration instead of a static phrase bank — a
          // bank only varies the WORDING while asking the customer the exact
          // same thing again, which is the literal complaint this fixes.
          const note = signals.refusesToPay
            ? 'كررت سؤال السداد بصياغة قريبة من ردك السابق، والعميل رفض السداد بصريح العبارة من قبل (وليس معترضاً على صحة الدين) — لا تسأل عن موعد/مقدار السداد مرة أخرى، ولا تطرح فكرة "تسجيل اعتراض" من عندك أبداً (هو لم يعترض)، فقط وضّح له بهدوء أن المديونية مسجَّلة وثابتة وأن الرفض لا يلغيها، واسأله بشكل مختلف عن سبب تردده.'
            : 'كررت سؤالاً سبق أن طرحته بصياغة مشابهة جداً — راجع رسائل العميل السابقة وانتقل للخطوة التالية الفعلية بدل إعادة نفس السؤال.'
          const corrected = await regenerateWithCorrection(client, modelId, systemPrompt, turns, text, note)
          if (corrected) {
            parsed.message = corrected
            parsed.reason = 'repeated_question_guard_regenerated'
          } else {
            // Regeneration itself failed (API error) — last-resort neutral
            // line, logged distinctly so a recurring failure here is visible.
            parsed.message = (intent === 'GREETING' || intent === 'SELF_INTRO' || intent === 'INFO_REQUEST')
              ? 'تمام، وضّح لي بس وش المطلوب بالضبط؟'
              : 'فهمت كلامك، بس محتاجين نتفق على خطوة عملية الحين — وش رأيك؟'
            parsed.reason = 'repeated_question_guard_regeneration_failed'
          }
        }
      }
    }
  }
  // (D2) Real regression this fixes: `hasIntroducedSelf` (used to decide
  // whether the SELF_INTRO stage should fire again) is a plain substring
  // check on 'خالد الدويحي'/'مصدر الرؤية' against the conversation history.
  // The (D) guard earlier only enforces that phrase when the customer
  // explicitly asks "من أنت؟" — but the SELF_INTRO STAGE ITSELF (the
  // scripted "معك خالد الدويحي من شركة مصدر الرؤية..." turn) was never
  // enforced the same way, so the model was free to paraphrase it
  // differently (e.g. drop "الدويحي", or say "معك خالد من مصدر الرؤية").
  // The very next turn's `hasIntroducedSelf` check would then read false,
  // and the agent introduced itself AGAIN — the exact "keeps reintroducing
  // itself" bug reported repeatedly. Enforcing the canonical phrase here,
  // guarantees the substring check downstream can never miss it again.
  // Runs LAST (after every other deterministic guard above already had a
  // chance to answer a real question/promise/policy issue directly) and
  // only fires if nothing else already changed the model's own reason —
  // a genuine answer to a real question always wins over this check.
  if (intent === 'SELF_INTRO' && parsed.action === 'reply' && parsed.reason === reasonBeforeGuards) {
    const m = parsed.message
    if (!m.includes('خالد الدويحي') || !m.includes('مصدر الرؤية')) {
      log.warn('self-introduction-stage guard fired — canonical phrase missing, would have broken next-turn detection', { original: m.slice(0, 80) })
      parsed.message = companyVal
        ? `معك خالد الدويحي من شركة مصدر الرؤية، وكيل ${companyVal}.`
        : 'معك خالد الدويحي من شركة مصدر الرؤية.'
      parsed.action = 'reply'
      parsed.reason = 'self_introduction_stage'
    }
  }

  // (D3) Real regression this fixes: the case file always includes the
  // "open dispute / pending dispute" facts (see buildCaseFile) so the model
  // can answer if asked — but nothing stopped it from proactively
  // volunteering "you have a dispute under review" as a filler line in
  // GENERAL/INFO_REQUEST turns where the customer never raised the topic at
  // all, or worse, right after the customer explicitly DENIED ever
  // disputing anything. This produced both the "cold, keeps repeating a
  // disclaimer" feel and the "tells the customer they're disputing when
  // they're not" complaint. Deterministic code-level suppression, not just
  // a prompt instruction, since the model repeatedly ignored the prompt
  // instruction alone across multiple real conversations.
  // Gated on `parsed.reason === reasonBeforeGuards` for the same reason as
  // (D2) above: if an earlier deterministic guard (premature-dispute guard,
  // repeated-question guard, forbidden-phrase guard, ...) already produced
  // this turn's final message, that correction always wins — this check
  // only applies to the model's OWN untouched output.
  if (intent !== 'DISPUTE' && intent !== 'INFO_REQUEST' && parsed.message.includes('اعتراض') && parsed.reason === reasonBeforeGuards) {
    const customerRaisedDisputeNow = hasAnyUnnegated(text, ['اعتراض', 'معترض']) || signals.dispute || signals.deniesDebt
    if (!customerRaisedDisputeNow) {
      log.warn('unsolicited-dispute-mention guard fired — stripping proactive dispute reference the customer did not raise this turn', { intent, original: parsed.message.slice(0, 80) })
      const corrected = await regenerateWithCorrection(
        client, modelId, systemPrompt, turns, text,
        'ردك السابق ذكر "الاعتراض المسجّل" رغم أن العميل لم يسأل عنه ولم يثره في رسالته الحالية — أعد الرد بدون أي إشارة للاعتراض إطلاقاً، وركّز فقط على ما قاله العميل الآن.',
      )
      if (corrected) {
        parsed.message = corrected
        parsed.reason = 'unsolicited_dispute_mention_regenerated'
      }
    }
  }

  // (D4) Real production incident this fixes: the customer said the agent
  // told them "رفعت طلبك للمراجعة" (I've submitted your request) but no
  // request ever reached the admin's approvals page — because the model
  // can generate that PROSE claim independently of the structured `action`
  // field, and the two can drift out of sync (the model says one thing,
  // the code does another). If the message promises a submitted
  // installment request but the action isn't actually
  // record_installment_request, the customer is being told something false
  // — strip that specific claim rather than let it reach them, and log
  // loudly so a recurrence is visible immediately instead of discovered
  // days later from a customer complaint.
  if (parsed.action !== 'record_installment_request' && hasAny(parsed.message, ['رفعت طلبك', 'رفعت الطلب', 'برفع طلبك', 'برفع الطلب', 'سأرفع طلبك', 'سارفع طلبك', 'رح ارفع طلبك', 'راح ارفع طلبك', 'تم رفع طلبك', 'تم رفع الطلب'])) {
    log.warn('action-claim mismatch guard fired — message promised a submitted installment request that was never actually recorded', { action: parsed.action, original: parsed.message.slice(0, 100) })
    const corrected = await regenerateWithCorrection(
      client, modelId, systemPrompt, turns, text,
      'ردك السابق قال للعميل إنك "رفعت طلبه" لكنك في الواقع لم تسجّل أي طلب فعلي — هذا يخبر العميل بمعلومة غير صحيحة. أعد الرد بدون الادّعاء بأنك رفعت أي طلب ما لم تكن فعلاً ستفعل ذلك الآن.',
    )
    if (corrected) {
      parsed.message = corrected
      parsed.reason = 'action_claim_mismatch_regenerated'
    }
  }

  // Carries the debt id the agent ACTUALLY reasoned about (may differ from
  // args.debt_id for multi-portfolio customers) so the webhook's
  // side-effect writes (promise/dispute/installment) attach to the right one.
  parsed.resolvedDebtId = forcedDebtId

  log.info('agent decision', {
    intent,
    action: parsed.action,
    reason: parsed.reason,
    balance: ctx.verified_debt_data?.current_balance ?? null,
    reply_preview: parsed.message.slice(0, 80),
  })

  if (!parsed.shouldReply || !parsed.message.trim()) {
    return { ...parsed, shouldReply: false, message: '' }
  }

  // Resolved here (not earlier) so the DB round-trip ran concurrently with
  // the LLM completion call above instead of adding to its latency.
  const fullOutboundHistory = await fullOutboundHistoryPromise
  if (fullOutboundHistory?.length) {
    prevOutbound = fullOutboundHistory.map((m: { content: string | null }) => m.content ?? '')
  }

  if (isRobotic(parsed.message) || isRepeated(parsed.message, prevOutbound)) {
    log.warn('anti-repetition guard fired', { intent, original: parsed.message.slice(0, 80) })
    // Same rule as the repeated-question guard: never bury a real customer
    // question under a "your promise is recorded" line. Only substitute the
    // promise confirmation when the customer did NOT ask anything.
    if ((openPromiseRec || promiseForcedFromTemporalRef) && !customerAskedSomething(text, signals)) {
      const dt = dateOnly((openPromiseRec ?? { promised_date: parsed.promised_date }).promised_date)
      parsed.message = dt
        ? `تمام، الوعد مسجّل عندي بتاريخ ${dt}. بانتظار سدادك.`
        : 'تمام، الوعد مسجّل عندي. بانتظار سدادك.'
      parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
      parsed.reason = 'anti_repetition_guard_promise_protected'
    } else if (openPromiseRec || promiseForcedFromTemporalRef) {
      const dt = dateOnly((openPromiseRec ?? { promised_date: parsed.promised_date }).promised_date)
      const corrected = await regenerateWithCorrection(
        client, modelId, systemPrompt, turns, text,
        `العميل سأل سؤالاً محدداً في رسالته الحالية ويجب أن تجيب عليه من ملف القضية مباشرة (لا تتجاهله). يوجد وعد سداد مسجّل مسبقاً${dt ? ` بتاريخ ${dt}` : ''} — لا تعيد سؤاله متى يسدد، لكن أجب على سؤاله الحالي أولاً وبشكل كامل.`,
      )
      parsed.message = corrected ?? parsed.message
      parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
      parsed.reason = corrected ? 'anti_repetition_guard_answered_with_promise_on_file' : 'anti_repetition_guard_regeneration_failed'
    } else {
      // Real corrective regeneration instead of a static phrase bank — see
      // regenerateWithCorrection's doc comment for why a bank doesn't fix this.
      const isRoboticHit = isRobotic(parsed.message)
      const note = isRoboticHit
        ? 'ردك السابق كان آلياً/فصيحاً أو بلهجة غير سعودية — أعد الصياغة بلهجة سعودية طبيعية بحتة، وبأسلوب إنسان حقيقي لا روبوت.'
        : signals.refusesToPay
          ? 'ردك السابق كرر سؤال السداد بعد رفض العميل الصريح للسداد من قبل — لا تسأل عن موعد/مقدار السداد مرة أخرى، تعامل مع رفضه مباشرة.'
          : 'ردك السابق يكرر معنى رد سابق لك في نفس المحادثة — لا تعد نفس الفكرة بصياغة أخرى، تعامل مع كلام العميل الحالي تحديداً.'
      const corrected = await regenerateWithCorrection(client, modelId, systemPrompt, turns, text, note)
      if (corrected) {
        parsed.message = corrected
        parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
        parsed.reason = 'anti_repetition_guard_regenerated'
      } else {
        parsed.message = (intent === 'GREETING' || intent === 'SELF_INTRO' || intent === 'INFO_REQUEST')
          ? 'تمام، تفضل بسؤالك.'
          : 'فهمت كلامك، بس محتاجين نتفق على شي عملي الحين — وش رأيك؟'
        parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
        parsed.reason = 'anti_repetition_guard_regeneration_failed'
      }
    }
  }


  return parsed
}
