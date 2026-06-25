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
import { detectMandatoryEscalation, getOpenEscalation, openEscalation, renderLegalPersonaReply, detectStcReviewSignal, recordStcReview } from '@/lib/legal-escalation'
import { COMPANY_IMPORT_PROFILES } from '@/lib/company-import-profiles'
import { renderStcKnowledgeForCaseFile, detectStcFieldMeaningQuestion } from '@/lib/stc-knowledge'
import { renderMobilyKnowledgeForCaseFile, detectMobilyFieldMeaningQuestion } from '@/lib/mobily-knowledge'
import {
  detectSevereDistress, renderDistressReply,
  detectOptOutIntent, renderOptOutConfirmation, setContactOptOut,
  getCustomerGateState, raiseUrgentHumanAlert,
  setPendingClarification, clearPendingClarification, pickUnusedVariant,
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

function hasAny(text: string, words: string[]) {
  const v = norm(text)
  return words.some(w => v.includes(w.toLowerCase()))
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

// ════════════════════════════════════════════════════════════════════
//  Temporal Parsing Layer — normalization scoped ONLY to time/promise
//  extraction (hasTemporalRef, hasCommitmentWithVagueTiming, grace-period
//  parsing, and any future temporal/promise detector). Deliberately NOT
//  used by hasAny()/norm() (dispute, identity, info-request, or any other
//  non-temporal signal) — folding this into the shared normalizer would
//  touch ~25 unrelated call sites for zero benefit there. Extend ONLY this
//  function as new common timing-spelling variants surface (بداية/بدايه,
//  نهاية/نهايه, الجمعة/الجمعه, الأسبوع/الاسبوع...) — never patch a single
//  alternate spelling directly into a detector's own regex/word list.
// ════════════════════════════════════════════════════════════════════
function normalizeTemporalText(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    // Hamza variants collapse to bare alef (الأسبوع/الاسبوع, أول/اول...).
    .replace(/[أإآ]/g, 'ا')
    // A word-final ه is overwhelmingly a colloquial mis-typing of the tied-ta
    // (بداية/بدايه, نهاية/نهايه, الجمعة/الجمعه) on Saudi WhatsApp — only at a
    // word boundary, never mid-word, so unrelated ه-final words (e.g. "عليه")
    // are left alone.
    .replace(/ه(?=\s|$)/g, 'ة')
}

// Broad, robust detection of an explicit pay date/time the customer stated,
// covering the many real spellings used on WhatsApp: بكرا/بكره/بكرة, غدا/غداً,
// اليوم, weekday names, نهاية/آخر الشهر, مع الراتب, numeric dates (30/6, يوم 30,
// 30 الشهر), and "خلال/بعد N يوم/اسبوع/شهر". Arabic numerals and common
// timing-spelling variants (see normalizeTemporalText) are normalised first.
// This REPLACES a narrow keyword list that missed "بكرا" and every
// Arabic-numeral date, which is what caused the post-promise questioning loop.
function hasTemporalRef(raw: string): boolean {
  const t = toAsciiDigits(normalizeTemporalText(raw))
  return (
    /(بكرا|بكره|بكرة|غدا|غدًا|غداً|اليوم|الحين|بعد بكر|بعد غد|عقب بكر)/.test(t) ||
    /(السبت|الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|الجمعة)/.test(t) ||
    /(الراتب|راتب|معاش)/.test(t) ||
    /(نهاية|اخر|بداية|اول|منتصف)\s*(الشهر|الاسبوع)/.test(t) ||
    /(نهاية الشهر|اخر الشهر|الشهر الجاي|الشهر القادم|الاسبوع الجاي|هالاسبوع|هالشهر)/.test(t) ||
    /\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\b/.test(t) ||
    /يوم\s*\d{1,2}/.test(t) ||
    /\b\d{1,2}\s*(الشهر|من الشهر|بالشهر|شهر)\b/.test(t) ||
    /(خلال|بعد|عقب|كل)\s*\d+\s*(يوم|ايام|اسبوع|اسابيع|شهر|شهور|اشهر)/.test(t)
  )
}

// §6 layer 2: a commitment verb plus a vague time hint that layer-1's
// lexicon didn't recognise — these are exactly the cases worth running the
// (expensive) structured-extraction fallback on, instead of on every message.
const COMMITMENT_VERBS = ['أسدد', 'اسدد', 'بسدد', 'أحول', 'احول', 'بحول', 'بدفع', 'ادفع', 'أدفع']
const VAGUE_TIME_HINT = /(قريب|قريباً|بسرعة|على طول|بعدين|لاحقاً|لاحقا|بأقرب وقت|في أقرب وقت)/

function hasCommitmentWithVagueTiming(text: string): boolean {
  const t = normalizeTemporalText(text)
  return COMMITMENT_VERBS.some(v => t.includes(normalizeTemporalText(v))) && VAGUE_TIME_HINT.test(t)
}

// §6 layer 2 — structured-extraction fallback. Only called when layer 1
// (the lexicon in hasTemporalRef) misses BUT the message still carries
// commitment language with a vague time reference the lexicon doesn't yet
// cover. Every case caught here is logged so the lexicon can be expanded
// later — this is a safety net, not a replacement for the lexicon.
async function detectTemporalRefStructured(
  client: OpenAI, text: string, todayISO: string
): Promise<{ has_temporal_ref: boolean; resolved_date: string | null; confidence: number } | null> {
  try {
    const r = await client.chat.completions.create({
      model: 'anthropic/claude-haiku-4.5',
      temperature: 0,
      max_tokens: 120,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `استخرج فقط: هل تتضمن رسالة العميل إشارة زمنية فعلية لموعد سداد (حتى لو غامضة)، وإن وُجدت حوّلها لتاريخ تقريبي YYYY-MM-DD اعتماداً على تاريخ اليوم ${todayISO}. أعد JSON فقط: {"has_temporal_ref": boolean, "resolved_date": "YYYY-MM-DD أو null", "confidence": 0 إلى 1}.`,
        },
        { role: 'user', content: text },
      ],
    })
    const raw = r.choices[0]?.message?.content ?? ''
    const obj = extractJson(raw)
    if (!obj || typeof obj !== 'object') return null
    return {
      has_temporal_ref: !!obj.has_temporal_ref,
      resolved_date: typeof obj.resolved_date === 'string' ? obj.resolved_date : null,
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    }
  } catch (err) {
    log.warn('temporal-ref layer-2 extraction failed', { error: String((err as any)?.message ?? err) })
    return null
  }
}

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
  'يوم': 1, 'يومين': 2, 'اسبوع': 7, 'اسبوعين': 14,
  'شهر': 30, 'شهرين': 60, 'شهر ونص': 45, 'شهر و نص': 45,
  'ثلاث شهور': 90, 'تلات شهور': 90, '3 شهور': 90, 'ثلاثة اشهر': 90,
}

// Best-effort detection of a grace period the customer is asking for, in
// days — used to deterministically stop the model from agreeing to
// anything beyond the policy max (30 days), since it doesn't reliably
// follow that instruction from prompt text alone.
function detectRequestedGraceDays(text: string): number | null {
  const t = toAsciiDigits(normalizeTemporalText(text))
  for (const [phrase, days] of Object.entries(ARABIC_WORD_NUM)) {
    if (t.includes(normalizeTemporalText(phrase))) return days
  }
  const numMonth = t.match(/(\d+)\s*شهر/)
  if (numMonth) return parseInt(numMonth[1]) * 30
  const numWeek = t.match(/(\d+)\s*اسبوع/)
  if (numWeek) return parseInt(numWeek[1]) * 7
  const numDay = t.match(/(\d+)\s*يوم/)
  if (numDay) return parseInt(numDay[1])
  return null
}

// Specific, checkable reasons for a dispute (as opposed to a bare "معترض"
// with nothing behind it) — used to stop the model from escalating to
// admin before it has even asked the customer why.
function hasSpecificDisputeReason(text: string): boolean {
  return hasAny(text, [
    'سددت', 'دفعت', 'حولت', 'مش انا', 'مو انا', 'ما اشتريت', 'مش اشتريت',
    'ليس لي', 'مش بيتي', 'مو بيتي', 'رقم غلط', 'مش دين', 'مو دين',
    'انكر', 'أنكر', 'تامين عندي', 'كان عندي تامين', 'باعت العقار', 'بعت العقار',
    'مالك جديد', 'مستاجر', 'مستأجر', 'خطأ في المبلغ', 'مبلغ غلط', 'زيادة في المبلغ',
  ])
}

function detectSignals(text: string) {
  return {
    paymentClaim: hasAny(text, ['سددت', 'دفعت', 'حولت', 'ايصال', 'إيصال', 'paid', 'receipt', 'transfer']),
    dispute: hasAny(text, ['غلط', 'اعتراض', 'مو صحيح', 'ما اعرف', 'ما أعرف', 'not mine', 'wrong amount']),
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
      'انت مين', 'وانت مين', 'انتا مين', 'مين هذا', 'منو انت',
    ]),
    // The customer explicitly denies having made any promise at all ("ما
    // وعدتك بشي") — distinct from deniesDebt (denying the debt itself). The
    // agent must NEVER restate/confirm the existing promise in this case.
    deniesPromise: hasAny(text, [
      'ما وعدتك', 'مو وعدتك', 'ماوعدتك', 'انا ما وعدت', 'أنا ما وعدت', 'لم اعدك', 'لم أعدك',
      'ما قلت لك بسدد', 'ما قلت بسدد', 'مين قال', 'وين قلت', 'ما اتفقنا', 'متى وعدتك', 'وعدتك متى',
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
  }
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
  ])
}

// Conservative: only flag a reply as "repeated" if it is essentially the SAME
// message as a previous one (near-exact). Never flag substantive replies that
// carry a number/amount/date — those are real answers, not robotic filler.
function isRepeated(reply: string, prevOutbound: string[]) {
  const r = reply.replace(/\s+/g, ' ').trim()
  if (!r || r.length < 20) return false
  if (/\d/.test(r)) return false // contains a figure → treat as a real answer
  return prevOutbound.some(p => {
    const old = p.replace(/\s+/g, ' ').trim()
    if (!old || old.length < 20) return false
    if (old === r) return true
    // near-duplicate only when lengths are close and one fully contains the other
    const ratio = Math.min(r.length, old.length) / Math.max(r.length, old.length)
    return ratio >= 0.85 && (old.includes(r) || r.includes(old))
  })
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

  // §1 — Identity verification gate: REMOVED by deliberate decision. The
  // conversation never asks for a national-ID/iqama last-4 challenge at any
  // point — recipient confirmation is handled instead by the first-contact
  // "معي الأخ/الأخت [الاسم]؟" question below, which doesn't require the
  // customer to disclose anything.

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
      log.info('legal escalation lock active — zero LLM call', { debt_id: forcedDebtId, escalation_type: openEsc.escalation_type })
      return {
        shouldReply: true,
        action: 'human_review',
        reason: 'legal_escalation_locked',
        message: renderLegalPersonaReply(openEsc.escalation_type),
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
  const playbook = await getPlaybookForPortfolio({
    company_id: args.company_id,
    portfolio_id: resolvedPortfolioId,
    category: resolvedCategory,
  })

  // ── Phase 3: Insurance Engine — classification is 100% data-driven from
  // customer_data_tawuniya/medgulf (already fetched by Phase 1's context
  // engine). Only ever built for category='insurance'; for every other
  // category this stays null and nothing insurance-specific is injected.
  const insuranceRow = playbook.category === 'insurance'
    ? (ctx360.customerDataByPortfolio[resolvedPortfolioId ?? 'no_portfolio'] ?? [])[0]
    : null
  const insuranceCase = insuranceRow ? classifyInsuranceCase(insuranceRow) : null
  const insuranceObjection = playbook.category === 'insurance' ? detectInsuranceObjectionSignals(text) : null

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
      isInsurancePortfolio: playbook.category === 'insurance',
      insuranceObjection,
      insuranceCase,
      customEscalationRules: playbook.escalation_rules,
      suppressLegalTriggers: isStcPortfolio,
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
      }
    }

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

  const prevOutbound = chronological.filter(m => m.direction === 'outbound').map(m => m.content).slice(-5)
  const lastAgentMessage = prevOutbound[prevOutbound.length - 1] ?? ''
  const hasHistory = chronological.length > 0

  // Absolute first-ever contact (no prior history at all) → the agent's
  // very first reply is ALWAYS the recipient-confirmation question, no
  // matter what the customer's first message actually says — never the
  // debt, never an ID/verification challenge (removed entirely), and never
  // a direct answer to a question asked in that same first message (that
  // comes on the NEXT turn, once the recipient is confirmed).
  if (!hasHistory) {
    const custFirstName = String(ctx.verified_customer_data?.customer_name ?? '').trim().split(' ')[0] || null
    const confirmQ = custFirstName ? `معي الأخ/الأخت ${custFirstName}؟` : 'تفضل؟'
    let msg = `يا هلا بك، ${confirmQ}`
    if (text.includes('سلام')) msg = `وعليكم السلام، ${confirmQ}`
    else if (text.includes('مساء')) msg = `مساء النور، ${confirmQ}`
    else if (text.includes('صباح')) msg = `صباح النور، ${confirmQ}`
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
  type AgentIntent = 'GREETING' | 'INTRODUCTION' | 'INFO_REQUEST' | 'NEGOTIATION' | 'DISPUTE' | 'GENERAL'
  let intent: AgentIntent = 'GENERAL'

  const balance = ctx.verified_debt_data?.current_balance != null ? String(ctx.verified_debt_data.current_balance) : null
  const creditor = ctx.verified_debt_data?.creditor_name ?? null
  const isTelecom = String(ctx.verified_debt_data?.portfolio_category ?? '').toLowerCase() === 'telecom'
  const historyText = chronological.map(h => h.content).join(' ')
  const hasMentionedDebt = (balance && historyText.includes(balance)) || (creditor && historyText.includes(creditor))
  // True only on the very first inbound ever (no prior outbound from us yet) —
  // we greet first and bring up the debt only once the customer has replied.
  const isFirstEverContact = chronological.every(h => h.direction !== 'outbound')

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
  if (signals.asksWhoAreYou || signals.asksCompany || signals.asksDetails || asksStcFieldMeaning || asksMobilyFieldMeaning) {
    intent = 'INFO_REQUEST'
  } else if (signals.deniesDebt) {
    intent = 'DISPUTE'
  } else if (!hasMentionedDebt && isFirstEverContact && !signals.angry && !signals.dispute) {
    intent = 'GREETING'
  } else if (!hasMentionedDebt && chronological.length <= 3 && !signals.angry && !signals.dispute) {
    intent = 'INTRODUCTION'
  } else if (signals.angry || signals.dispute || signals.wrongNumber) {
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
    : `- 🔴 صلاحية التقسيط: لا تملك صلاحية اعتماد تقسيط أو تحديد مبلغ شهري/عدد دفعات بنفسك — هذا قرار الإدارة. لكن لا ترفض طلب العميل رفضاً جافاً ولا تردّ بقالب آلي.
  - أولاً (الأهم): حاول كمحصّل خبير إقناعه بالسداد الكامل أو دفعة كبيرة مقدّمة الآن (اربطها بمصلحته: إغلاق الملف، تجنّب التصعيد، راحة البال). تفاوض بذكاء قبل أي شيء.
  - إن أصرّ فعلاً على التقسيط بعد محاولتك: اطلب منه أن يقترح هو التصوّر الذي يناسبه (كم دفعة وكم شهرياً ومتى يبدأ)، وقل له بأسلوب بشري إنك سترفع طلبه للإدارة للنظر فيه دون أن تعده بالموافقة، واختر action=record_installment_request. لا تذكر أرقاماً أو جدولاً من عندك إطلاقاً.
  - الهدف: تبدو كمحصّل يحاور ويحاول الحل، لا كموظف يحوّل كل شيء للإدارة فوراً.`

  const intentPrompts: Record<AgentIntent, string> = {
    GREETING: `【 مهمتك الآن: الترحيب فقط 】
- هذه أول رسالة من العميل ولم تتحدثا من قبل. رحّب به بتحية طبيعية وعرّف نفسك باسمك فقط (خالد) دون ذكر "محصّل ديون" ودون ذكر الجهة الدائنة ولا المبلغ ولا أي تفاصيل عن المديونية إطلاقاً في هذه الرسالة.
- اسأله سؤالاً عاماً لطيفاً (مثل: كيف حالك / إيش أخبارك) وانتظر رده.
- 🔴 ممنوع تماماً ذكر أي شيء عن الدين أو المبلغ أو الجهة الدائنة في هذه الرسالة بالذات — هذا يأتي في ردك التالي بعد أن يرد العميل.
- سطر واحد قصير فقط.`,
    INTRODUCTION: `【 مهمتك الآن: التقديم 】
- العميل ردّ على ترحيبك. الآن وفقط الآن عرّفه أنك تتواصل من طرف الجهة الدائنة بخصوص المديونية القائمة.
- اذكر اسم الجهة والمبلغ مرة واحدة فقط، ثم اسأله مباشرة: متى يقدر يسدد؟
- سؤال واحد فقط، لا أكثر.`,
    INFO_REQUEST: `【 مهمتك الآن: الرد المباشر على سؤال العميل من بيانات النظام 】
- العميل سأل سؤالاً مباشراً: من أنت، أو وش الشركة/الجهة، أو طلب تفاصيل أكثر عن ملفه.
- 🔴 إذا سأل "من أنت؟" أو ما يشابهها: يجب أن تتضمن إجابتك هذي الحقائق الثلاثة فعلاً (اسمك خالد الدويحي، أنك من شركة مصدر الرؤية، أنك وكيل متابعة مطالبات شركة [الجهة] — استبدل [الجهة] باسم الجهة/المحفظة من "ملف القضية" إن وُجد) لكن بصياغتك الطبيعية الخاصة المتماشية مع سياق الحوار، لا نصاً مكرراً حرفياً كل مرة.
- إذا سأل عن الشركة/الجهة: اذكر اسم الجهة الدائنة أو المحفظة كما هو في "ملف القضية" بالضبط. لا تقل "ما عندي معلومة" أو "أرجع للإدارة" إذا كان الاسم موجوداً في الملف.
- إذا طلب "التفاصيل": اذكر كل ما هو متاح فعلياً في ملف القضية بصيغة واضحة ومرتبة (الجهة، رقم الحساب، رقم المنتج/السداد إن وجد، المبلغ، الرقم المرجعي) — لا تكتفِ بالمبلغ والرقم المرجعي فقط إن وُجدت تفاصيل إضافية في الملف.
- 🔴 لا تطلب من العميل معلومة هو من المفروض أن يحصل عليها منك (مثل رقم حسابه) — أنت من يملك هذي المعلومة ويعطيها له، لا العكس.
- إن كانت بعض التفاصيل المطلوبة فعلاً غير موجودة في الملف (لا اسم جهة ولا رقم حساب ولا أي شيء): وضّح فقط أن هذا الجزء بالذات غير متوفر حالياً، وقل إنك ستتحقق منه، بدل التعميم بأن "كل شيء غير معروف".
${isStcPortfolio ? '- 🔴 إذا سأل عن "رقم الخدمة" أو "رقم الحساب" أو "نوع الخدمة" أو معنى "مع جهاز/بدون جهاز" أو معنى "تاريخ التعثر": أجب مباشرة من قسم "معرفة تشغيلية خاصة بـ STC" في ملف القضية إن وُجد — لا تحوّل للإدارة ولا تصعّد، هذي معلومة عادية تشرحها بنفسك فوراً.' : ''}
${isMobilyPortfolio ? '- 🔴 إذا سأل عن "رقم الخدمة" أو "رقم الحساب" أو "حالة الخدمة" أو "طريقة/رقم السداد": أجب مباشرة من قسم "معرفة تشغيلية خاصة بموبايلي" في ملف القضية. عند سؤاله عن رقم السداد، أعطه فقط الرقم الصحيح المحدّد هناك حسب حالة الخدمة (Inactive→رقم الخدمة، Closed→رقم الحساب) — ممنوع إعطاء الرقم الخطأ.' : ''}
- 🔴🔴 ممنوع منعاً باتاً إضافة أي ضغط سداد أو تذكير بموعد أو مطالبة بالدفع في هذا الرد — مهمتك الآن فقط الإجابة على سؤاله. لا تكتب "والمهم موعدك..." أو "بانتظار سدادك" أو أي جملة تعيد الحديث عن السداد، إلا إذا كان العميل نفسه سأل في رسالته الحالية عن السداد أو الموعد أو وعد به. الرد يتوقف عند الإجابة على سؤاله فقط.`,
    DISPUTE: `【 مهمتك الآن: فهم الاعتراض، مناقشته، وإقناع العميل — لا تصعيد سريع 】
- العميل غاضب أو ينكر المديونية أو يقول الرقم خطأ أو يقول "معترض" بدون أي تفصيل.
- 🔴 أهم قاعدة: إن لم يذكر العميل سبباً محدداً للاعتراض بعد، فمهمتك الوحيدة الآن سؤاله بوضوح وبأدب عن سبب اعتراضه. ممنوع تأكيد صحة الدين قبل أن يوضّح السبب.
- إن كان غاضباً فقط (بدون سبب واضح): امتص غضبه بكلمة واحدة ثم اسأله عن السبب.
- إذا ذكر سبباً: لا تكتفِ بشرح واحد فقط — **ناقشه وحاوره فعلياً**. وضّح مصدر الدين من ملف القضية، واستمع لردّه، وإن استمر بالشك أعد التوضيح بطريقة أخرى أو بمعلومة إضافية من الملف. هدفك إقناعه بصحة الدين أو الوصول لالتزام واضح منه (سداد أو تقديم إثبات)، وليس فقط شرح واحد وإغلاق الموضوع.
- 🟠 ليس كل اعتراض يُصعَّد للإدارة. لا تختر record_dispute من أول رد. استمر بالنقاش 2-3 ردود على الأقل ما لم يطلب العميل إثباتاً صريحاً منك لا تملكه.
- إن شعرت أن العميل **يماطل أو يرفض عمداً** (يكرر نفس الإنكار دون سبب منطقي جديد، أو يتجاهل أسئلتك المباشرة): لا تصمت ولا تسجّل اعتراضاً تلقائياً — **زِد الضغط المهني**: كن أكثر حزماً، ${isStcPortfolio ? 'وضّح له بأدب أن الموضوع يحتاج حلاً قريباً ومتابعة جادة من جهته' : 'ذكّره بالعواقب (تصعيد قانوني/إدارة) بأدب'}، واستمر بالمتابعة. الصمت أو إنهاء الحوار بسرعة غير مقبول مع المماطل.
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
- 🔴 قبل أن تقول "لا توجد لدي معلومة" أو "سأرجع للإدارة": راجع "ملف القضية" كاملاً أولاً (الجهة، نوع المنتج، الرصيد، الرقم المرجعي، تاريخ الاستحقاق، ملاحظات لوحة التحكم) — أغلب أسئلة العميل لها جواب فيه. لا تحوّل للإدارة إلا إذا كانت المعلومة غير موجودة فعلاً في الملف أو تحتاج صلاحية إدارية خاصة (مثل تخفيض المبلغ${isStcPortfolio ? '' : ' أو إجراء قانوني'}).
- لو العميل يتجاهل أسئلتك أو يكرر كلاماً عاماً بلا التزام: لا تسكت ولا تنهِ المحادثة — زِد الضغط بلطف واطلب إجابة مباشرة وواضحة.
- 🔴 ممنوع تكرار ذكر المبلغ أو اسم الجهة، اكتفِ بسؤاله عن الخطوة القادمة.`,
  }

  const stcRow = isStcPortfolio
    ? (ctx360.customerDataByPortfolio[resolvedPortfolioId ?? 'no_portfolio'] ?? [])[0] ?? null
    : null
  const mobilyRow = isMobilyPortfolio
    ? (ctx360.customerDataByPortfolio[resolvedPortfolioId ?? 'no_portfolio'] ?? [])[0] ?? null
    : null
  const caseFile = buildCaseFile(ctx, stcRow, mobilyRow)
  const strictRules = Array.isArray(ctx.strict_rules) ? ctx.strict_rules.join('\n') : ''
  const np = ctx.negotiation_profile ?? {}

  // Conversation as real message turns (chronological), capped to last 10.
  const turns = chronological.slice(-10).map(m => ({
    role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }))

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const todayWeekday = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', weekday: 'long' }).format(new Date())

  const systemPrompt = `أنت "خالد"، محصّل ديون سعودي محترف عمره 45 سنة ولديه خبرة تتجاوز 20 سنة في تحصيل ديون كل القطاعات (اتصالات، تأمين، مرافق، تمويل، استقدام، زراعي). تتحدث بلهجة سعودية بيضاء طبيعية جداً عبر الواتساب، كأنك إنسان حقيقي يجلس أمام العميل.
🔴 ممنوع منعاً باتاً استخدام أي لهجة غير سعودية (مصرية، سودانية، شامية، أو أي لهجة خليجية أخرى) أو الفصحى الرسمية الثقيلة في أي رد — السعودية البيضاء فقط دائماً، بدون استثناء.

🎯 شخصيتك كمحصّل خبير (التزم بها في كل رد):
- واثق وهادئ وحازم، لا تتوسّل ولا تعتذر بإفراط، ولا تتنازل بسهولة.
- تقرأ نفسية العميل: المتعاون تشجّعه، المتردد توجّهه بخطوة واضحة، المماطل تضغط عليه بحزم مهني، الغاضب تمتص غضبه ثم تعيده للحل.
- تتحاور وتقنع بأسلوب بشري متنوّع، لا تكرّر نفس الجملة، ولا ترد بقوالب جاهزة. كل رد يبدو مفكَّراً فيه ومبنياً على ما قاله العميل بالضبط.
- تربط الكلام بمصلحة العميل (${isStcPortfolio ? 'تفادي زيادة المبلغ، إغلاق الملف وراحة باله' : 'تجنّب التصعيد القانوني، تفادي زيادة المبلغ، إغلاق الملف وراحة باله'}) لا بمجرد المطالبة.
- جملك قصيرة ومباشرة وواقعية، بلا حشو ولا لغة رسمية جامدة. تكلّم كإنسان خبير لا كروبوت.
- لا تنقل كل شيء للإدارة؛ أنت صاحب القرار في الحوار والإقناع، والإدارة فقط لما يخرج عن صلاحيتك فعلاً.

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

═══════════════ ${intentPrompts[intent].split('\n')[0].replace(/【|】/g, '').trim()} ═══════════════
${intentPrompts[intent]}

═══════════════ قائمة تحقّق إلزامية قبل كل رد ═══════════════
1. اقرأ المحادثة السابقة كاملة: ما آخر سؤال سألته أنت؟ هل أجاب العميل عليه؟ لا تعد طرح سؤال مُجاب.
2. راجع "ما تم الاتفاق عليه": لا تتجاهل وعداً قائماً أو تقسيطاً معتمداً.
3. لا تخترع أي رقم/اسم/تاريخ غير موجود في ملف القضية. لكن قبل أن تقول "ما عندي معلومة" أو "بحوّلها للإدارة"، راجع ملف القضية كاملاً جيداً — أغلب المعلومات (الجهة، المنتج، الرصيد، الرقم المرجعي، التواريخ، الملاحظات) موجودة فيه فعلاً. التحويل للإدارة فقط عند معلومة غير موجودة حقاً في الملف، أو قرار يحتاج صلاحية إدارية (${isStcPortfolio ? 'تخفيض، قبول اعتراض' : 'تخفيض، تصعيد قانوني، قبول اعتراض'}).
4. لا تكرر ذكر المبلغ إلا إذا كان هذا أول تعريف بالمديونية.
5. تكلم كإنسان: لا "عزيزي العميل"، لا "كيف أقدر أخدمك"، لا عبارات آلية.
6. لو وافق العميل على السداد أو سأل "كيف أدفع/وين أحوّل": أعطه طريقة الدفع من "ملف القضية" (الآيبان أو المفوتر) واطلب منه إرسال صورة الإيصال بعد التحويل. لا تخترع آيباناً غير الموجود.
7. الرد جملة أو جملتين كحد أقصى.
8. 🔴 ${prevOutbound.length === 0 ? 'هذه أول رسالة ترسلها لهذا العميل — يجوز ذكر اسمه مرة واحدة فقط هنا.' : 'سبق أن أرسلت لهذا العميل رسائل قبل — ممنوع ذكر اسمه كعادة أو تلطّف في ردك الآن (لا تبدأ الجملة باسمه). الاستثناء الوحيد: لو سألك صريحاً "ايش اسمي" أو "المديونية باسم مين" فاذكر اسمه كإجابة مباشرة على سؤاله فقط، ثم لا تكرره بعد ذلك.'}
9. 🔴 shouldReply=false أو action=silent مسموح فقط إذا كانت رسالة العميل **توديعاً أو شكراً صريحاً واضحاً بلا أي سؤال أو طلب أو شكوى** (مثل "تمام شكراً" أو "خلاص يعطيك العافية"). أي رسالة فيها سؤال، شكوى، اعتراض، طلب، رفض، أو معلومة جديدة — حتى لو قصيرة أو غامضة — **يجب** أن يكون لها رد واضح. لا تستخدم silent أو close_conversation للتهرّب من رسالة صعبة أو غير واضحة؛ اطلب توضيحاً بدلاً من الصمت.
10. 🔴 الحد الأقصى المطلق لأي مهلة أو تأجيل = 30 يوماً من تاريخ اليوم (${todayStr}) ولا يوماً أكثر تحت أي ظرف. إن طلب العميل أكثر من ذلك (شهرين، 3 شهور، أو ما شابه)، فرفضك إلزامي — لا تقل "ما عندي مشكلة" ولا توافق ضمنياً. اعرض عليه مدة أقصر بكثير (أسبوع إلى أسبوعين) وفاوضه نزولاً، ولا توافق على الشهر كاملاً إلا بعد محاولة تقصيره أولاً.
11. 🔴 لا تختار action=record_dispute أبداً في أول رد على كلام فيه اعتراض غامض بلا سبب محدد (راجع تعليمات DISPUTE أعلاه) — اسأل عن السبب أولاً دائماً.
12. 🔴 استخدم أساليب إقناع متنوعة فعلية لا تكرار نفس الجملة: التذكير بالعواقب بأدب، عرض حل وسط، تحديد خطوة صغيرة فورية (صورة إيصال، تاريخ محدد)، الإشارة إلى أن التأخير يزيد تعقيد الملف. إن شعرت أن العميل يرفض أو يماطل عمداً زِد الحزم والضغط ولا تستسلم أو تصمت.
13. 🔴🔴 تسجيل الوعد (افهمه دلالياً لا بكلمات محفوظة): إذا ربط العميل السداد **بأي تعبير زمني أو مناسبة** مهما كانت صياغته — تاريخ صريح، يوم نسبي (بكرا/اليوم/بعد بكرة)، يوم أسبوع، بداية/نهاية/منتصف الشهر أو الأسبوع، نزول الراتب، الدعم، حساب المواطن، مكافأة/عيدية، بيع شيء، أو أي وقت طبيعي آخر يقصده — فهذا **وعد** واختر action=record_promise. لا تشترط صيغة معيّنة.
   - عبّئ حقلين معاً: (1) promise_text = توقيت العميل بكلماته/معناه كما قاله بالضبط (مثل "مع نزول الراتب"، "بداية الشهر الجاي"، "عند نزول حساب المواطن"، "بكرا"). (2) promised_date = أفضل تحويل دقيق إلى YYYY-MM-DD اعتماداً على تاريخ اليوم الحقيقي (${todayStr}) والمنطقة الزمنية والسياق. لو التعبير قابل للتحويل لتاريخ فعلي حوّله؛ لو نسبي/ظرفي لا يُحوَّل بدقة، ضع أقرب تاريخ متابعة منطقي في promised_date واحفظ المعنى الحقيقي في promise_text. لا تخمّن عشوائياً، استنتج بمنطق من اليوم.
   - لا تختر record_promise إلا إذا ذكر العميل توقيتاً فعلاً في رسالته. مجرد "بسدد" بلا أي إشارة زمنية = نية لا وعد → اسأله عن التوقيت مرة واحدة (action=negotiate). ومتى ما أعطى توقيتاً، لا تعد سؤاله عنه أبداً بعد تسجيله.

═══════════════ صيغة الإخراج ═══════════════
أعد JSON فقط بهذا الشكل، بدون أي نص خارجه:
{
  "shouldReply": true,
  "action": "reply|silent|request_proof|request_clarification|negotiate|pressure|close_conversation|record_installment_request|record_promise|record_dispute|human_review",
  "reason": "سبب مختصر",
  "message": "رد الواتساب أو فارغ",
  "promised_date": "YYYY-MM-DD أو null — مع action=record_promise: أفضل تحويل لتوقيت العميل اعتماداً على تاريخ اليوم",
  "promise_text": "توقيت العميل بكلماته (مثل: مع الراتب / بداية الشهر الجاي / بكرا) — فقط مع action=record_promise، وإلا null"
}

🔴 تذكير أخير لا تنساه: لا تخترع بيانات، لا تكرر سؤالاً مُجاباً، التزم بما اتُّفق عليه، وردك قصير وبشري.`

  const requestedGraceDays = detectRequestedGraceDays(text)
  const disputeReasonGiven = hasSpecificDisputeReason(text)

  // §9: Haiku for routine intents, Sonnet for the intents that actually
  // require careful judgment (dispute handling, negotiation). Confirmed
  // exact OpenRouter slugs via the live /models API before wiring this in —
  // these are NOT the raw Anthropic API model ids.
  const selectModel = (i: AgentIntent): string =>
    (['DISPUTE', 'NEGOTIATION'] as AgentIntent[]).includes(i) ? 'anthropic/claude-sonnet-4.6' : 'anthropic/claude-haiku-4.5'
  const modelId = selectModel(intent)
  log.info('model routing', { intent, modelId })
  let ai
  try {
    ai = await client.chat.completions.create({
      model: modelId,
      temperature: 0.6,
      max_tokens: 400,
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
${intent === 'DISPUTE' && !disputeReasonGiven ? '- 🔴 العميل لم يذكر سبباً محدداً للاعتراض في هذه الرسالة — لا تصعّد، اسأله عن السبب أولاً.' : ''}

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

  // 2) Never let the model escalate a vague dispute to admin before it has
  // actually asked the customer for a specific reason.
  if (intent === 'DISPUTE' && !disputeReasonGiven && parsed.action === 'record_dispute') {
    log.warn('premature dispute escalation guard fired', { intent, original: parsed.message.slice(0, 80) })
    parsed.message = 'تمام، بس عشان أقدر أساعدك بسرعة — وضّح لي إيش بالضبط سبب اعتراضك على المبلغ؟'
    parsed.action = 'request_clarification'
    parsed.reason = 'dispute_reason_guard_override'
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
  const negatesImmediateTiming = /(مو|ما|ماني|مب)\s*(الحين|اليوم|بكرا|بكرة)/.test(normalizeTemporalText(text))
  let promiseForcedFromTemporalRef = false
  if (hasTemporalRef(text) && !negatesImmediateTiming && parsed.action !== 'record_promise' && !signals.deniesDebt && !signals.deniesPromise) {
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
    let isRealPromise = hasTemporalRef(text)
    // §6 layer 2 — only spend a model call when layer 1 missed AND the
    // message looks like a vague commitment ("بسدد قريب") that's worth the
    // extra check, rather than on every single record_promise candidate.
    if (!isRealPromise && hasCommitmentWithVagueTiming(text)) {
      const layer2 = await detectTemporalRefStructured(client, text, todayStr)
      if (layer2 && layer2.has_temporal_ref && layer2.confidence >= 0.6) {
        log.info('temporal-ref layer-2 caught a promise layer-1 missed — candidate for lexicon expansion', {
          text_preview: text.slice(0, 80), resolved_date: layer2.resolved_date, confidence: layer2.confidence,
        })
        isRealPromise = true
        if (layer2.resolved_date && isSaneDate(layer2.resolved_date, todayStr) && !validDate) {
          parsed.promised_date = layer2.resolved_date
        }
      }
    }
    if (isRealPromise) {
      parsed.promise_text = promiseText || null
      // `promised_date` is NOT NULL in the DB → always store one. Prefer the
      // model's sane date; otherwise a near follow-up checkpoint from today.
      // The real verbal promise is preserved in promise_text either way.
      if (!parsed.promised_date || !isSaneDate(String(parsed.promised_date), todayStr)) parsed.promised_date = addDaysISO(todayStr, 3)
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
      if (openPromiseRec) {
        // A promise is ALREADY on file → acknowledge it, never re-ask.
        const dt = dateOnly(openPromiseRec.promised_date)
        log.warn('record_promise w/o timing but promise already on file — acknowledging', { dt })
        parsed.message = dt
          ? `تمام، الوعد مسجّل عندي بتاريخ ${dt}. بانتظار سدادك، وأرسل لي صورة الإيصال بعد التحويل.`
          : 'تمام، الوعد مسجّل عندي. بانتظار سدادك، وأرسل لي صورة الإيصال بعد التحويل.'
        parsed.action = 'reply'
        parsed.reason = 'promise_already_on_file'
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
        ? `تمام، أنا مسجّل إنك بتسدد بتاريخ ${dt}. بانتظارك، وأول ما تحوّل أرسل لي صورة الإيصال.`
        : 'تمام، الوعد مسجّل عندي وبانتظار سدادك. أرسل لي صورة الإيصال بعد التحويل.'
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
      parsed.message = 'طيب، بس بمراجعة هذي النقطة من عندنا — متى كان آخر تواصل بخصوص موعد السداد من جهتك؟'
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

    // (L3) STC bans the agent from proposing/mentioning installments unless
    // the CUSTOMER'S OWN current message explicitly asked for one
    // (signals.installment). The prompt instruction (§installmentRule above)
    // is not reliable enough on its own — this is the deterministic backstop
    // that strips any leaked تقسيط/أقساط/قسط/جدولة mention from the reply.
    if (isStcPortfolio && !signals.installment) {
      const INSTALLMENT_LEAK_PATTERN = /(تقسيط|أقساط|اقساط|قسط(?!ت)|جدولة)/
      if (INSTALLMENT_LEAK_PATTERN.test(parsed.message)) {
        log.warn('STC installment mention stripped — customer did not request it', { original: parsed.message.slice(0, 120) })
        parsed.message = 'تمام، سجلت وعدك بالسداد. بنحدّث الحالة بعد السداد.'
        if (parsed.action === 'record_installment_request') parsed.action = 'negotiate'
        parsed.reason = 'stc_installment_leak_blocked'
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
        // A promise already exists (on file, or just force-recorded above) →
        // never inject a "when will you pay" fallback; only ever confirm it.
        if (openPromiseRec || promiseForcedFromTemporalRef) {
          const dt = dateOnly((openPromiseRec ?? { promised_date: parsed.promised_date }).promised_date)
          parsed.message = dt
            ? `تمام، الوعد مسجّل عندي بتاريخ ${dt}. بانتظار سدادك.`
            : 'تمام، الوعد مسجّل عندي. بانتظار سدادك.'
          parsed.reason = 'repeated_question_guard_promise_protected'
        } else {
          // Payment-pressure fallbacks only make sense once the conversation is
          // actually about negotiating payment. A repeated GREETING/INFO_REQUEST
          // reply must never be replaced by a payment nudge — that was the exact
          // cause of the agent pushing "متى تسدد؟" onto a plain greeting or an
          // info question.
          const movesNeutral = [
            'طيب، خلنا نمشي قدام — وش تحتاج تعرفه أكثر؟',
            'تمام، وضّح لي بس وش المطلوب بالضبط؟',
            'خلاص، فهمت. عندك أي سؤال آخر؟',
            'تمام، استوعبت. في شي ثاني تبي تعرفه؟',
            'ماشي، الكلام واضح. تحتاج أي توضيح إضافي؟',
          ]
          const movesPayment = [
            'طيب، خلنا نمشي قدام — وش الخطوة اللي تناسبك الحين؟',
            'تمام، الموضوع يحتاج حل. وش تقترح؟',
            'فهمت عليك. تبي نرتّب طريقة السداد؟',
            'خلاص، فهمت وضعك. إيش الحل اللي يناسبك من جهتك؟',
            'طيب، بدال ما نكرر نفس الكلام — وش تقدر تسوي الحين؟',
            'تمام. خلنا نركّز على الخطوة الجاية، وش رأيك؟',
            'فهمتك. بس محتاجين نتفق على شي عملي الحين.',
            'ماشي، الكلام واضح. طيب وش القرار من جهتك؟',
            'تمام، استوعبت كل اللي قلته. الحين وش الخطة؟',
            'طيب، خلنا نوصل لشي ملموس — وش تقترح؟',
            'فهمت، بس لازم نتحرك للأمام. وش رايك نسوي؟',
            'تمام، واضح كلامك. إيش اللي يناسبك كخطوة قادمة؟',
            'خلاص فهمت الموضوع. طيب وش الحل من ناحيتك؟',
            'ماشي، بس نحتاج نقرر شي الحين — وش تشوف؟',
            'تمام، استلمت كلامك. وش الخطوة اللي نقدر نمشي بها؟',
          ]
          const moves = (intent === 'GREETING' || intent === 'INFO_REQUEST') ? movesNeutral : movesPayment
          parsed.message = await pickUnusedVariant(args.customer_id, 'repeated_question', moves)
          parsed.reason = 'repeated_question_guard'
        }
      }
    }
  }

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

  if (isRobotic(parsed.message) || isRepeated(parsed.message, prevOutbound)) {
    log.warn('anti-repetition guard fired', { intent, original: parsed.message.slice(0, 80) })
    // Same fix as guard (C) above: a greeting or an info-request reply that
    // happens to look "robotic"/repeated must never be force-replaced with a
    // payment nudge — only NEGOTIATION/GENERAL/DISPUTE/INTRODUCTION turns are
    // actually about pushing payment forward.
    const fallbacksNeutral = [
      'طيب، تفضل — وش تحتاج؟',
      'تمام، أنا موجود. عندك أي استفسار آخر؟',
      'خلاص، فهمت. في شي ثاني أساعدك فيه؟',
      'تمام، تفضل بسؤالك.',
      'ماشي، وضّح لي بس وش المطلوب.',
    ]
    const fallbacksPayment = [
      'طيب، وش تبي نسوي بخصوص الموضوع؟',
      'تمام، خلنا نمشي قدام. وش الخطوة الجاية من عندك؟',
      'فهمت عليك. تبي نتكلم عن طريقة السداد؟',
      'ماشي، بس أبي أعرف متى تقدر تسدد؟',
      'أوكي، بس الموضوع يحتاج حل. متى نتوقع السداد؟',
      'تمام، بس محتاج جواب محدد منك. وش تشوف؟',
      'فهمت، بس الملف يحتاج حل قريب. وش رايك؟',
      'ماشي، خلنا نحدد خطوة عملية الحين.',
      'أوكي، بس وضّح لي وش الخطة من جهتك؟',
      'تمام، استوعبت. بس وش الحل اللي تقترحه؟',
      'طيب، نحتاج نقفل هالموضوع. متى ممكن تسدد؟',
      'فهمتك، بس خلنا نمشي بخطوة فعلية الحين.',
      'ماشي، بس أبغى أعرف القرار النهائي منك.',
      'تمام، وش رايك نرتّب موعد سداد واضح؟',
    ]
    // A promise already exists (on file, or just force-recorded above) →
    // never fall back to a "when will you pay" payment nudge here either.
    if (openPromiseRec || promiseForcedFromTemporalRef) {
      const dt = dateOnly((openPromiseRec ?? { promised_date: parsed.promised_date }).promised_date)
      parsed.message = dt
        ? `تمام، الوعد مسجّل عندي بتاريخ ${dt}. بانتظار سدادك.`
        : 'تمام، الوعد مسجّل عندي. بانتظار سدادك.'
      parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
      parsed.reason = 'anti_repetition_guard_promise_protected'
    } else {
      const fallbacks = (intent === 'GREETING' || intent === 'INFO_REQUEST') ? fallbacksNeutral : fallbacksPayment
      parsed.message = await pickUnusedVariant(args.customer_id, 'anti_repetition', fallbacks)
      parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
      parsed.reason = 'anti_repetition_guard'
    }
  }

  return parsed
}
