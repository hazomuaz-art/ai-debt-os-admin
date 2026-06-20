import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
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
  const t = norm(text)
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

// ════════════════════════════════════════════════════════════════════
//  Case file — the "memory" the agent reviews BEFORE every reply.
//  Pulls verified DB facts, what was agreed, dashboard notes & history.
// ════════════════════════════════════════════════════════════════════

function buildCaseFile(ctx: any): string {
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
  add('المدينة', c.city)
  add('جهة العمل', c.employer)
  add('مستوى الخطورة', c.risk_level)

  // 2) The debt facts (the ONLY numbers/names allowed)
  lines.push('')
  lines.push('【 بيانات المديونية المؤكدة 】')
  add('الجهة الدائنة', d.creditor_name)
  add('قطاع الجهة الدائنة', { telecom: 'اتصالات', insurance: 'تأمين', utility: 'مرافق (كهرباء/ماء/طاقة)', recruitment: 'استقدام عمالة', government: 'حكومي', finance: 'تمويل', agriculture: 'زراعي', other: null }[String(d.portfolio_category ?? '').toLowerCase()] ?? null)
  add('نوع المنتج', d.product_type)
  add('الرصيد الحالي المستحق', money(d.current_balance, currency))
  add('المبلغ الأصلي', money(d.original_amount, currency))
  add('الرقم المرجعي', d.reference_number)
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
    agreed.push(`📌 وعد سداد قائم${amt ? ` بمبلغ ${amt}` : ''}${dt ? ` بتاريخ ${dt}` : ''} — ذكّر العميل به وألزمه.`)
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

  // 3b) Payment method (give to the customer when they agree to pay)
  const acc = ctx.collection_account
  if (acc) {
    const payLines: string[] = []
    if (acc.method_type === 'sadad_biller' && acc.biller_code) {
      payLines.push(`طريقة السداد المعتمدة: سداد المفوتر "${acc.biller_name ?? ''}" رمز ${acc.biller_code}. وجّه العميل يسدد عبر تطبيق بنكه بهذا المفوتر.`)
    } else if (acc.iban) {
      payLines.push(`طريقة السداد المعتمدة: تحويل بنكي على الآيبان ${acc.iban}${acc.account_name ? ` باسم ${acc.account_name}` : ''}${acc.bank_name ? ` - ${acc.bank_name}` : ''}. اطلب من العميل إرسال صورة الإيصال بعد التحويل.`)
    }
    if (acc.instructions) payLines.push(`تعليمات إضافية: ${acc.instructions}`)
    if (payLines.length) {
      lines.push('')
      lines.push('【 طريقة الدفع (أعطها للعميل فقط عند اتفاقه على السداد) 】')
      payLines.forEach(l => lines.push(`- ${l}`))
    }
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
  const text = args.message.trim()
  const signals = detectSignals(text)

  // Fast path: customer ended the chat → stay silent, no cost.
  if (isCloser(text)) {
    return { shouldReply: false, action: 'close_conversation', reason: 'customer_closed_chat', message: '' }
  }

  // ── Always review the case file + history from the DB BEFORE replying ──
  const ctx = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

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

  // Pure greeting with NO prior history → light canned reply (true first contact).
  // If there IS history, fall through to the AI so it uses what was discussed.
  if (isGreeting(text) && !hasHistory) {
    let msg = 'يا هلا بك، تفضل؟'
    if (text.includes('سلام')) msg = 'وعليكم السلام، حياك الله تفضل؟'
    else if (text.includes('مساء')) msg = 'مساء النور، تفضل؟'
    else if (text.includes('صباح')) msg = 'صباح النور، تفضل؟'
    return { shouldReply: true, action: 'reply', reason: 'greeting_first_contact', message: msg }
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return { shouldReply: true, action: 'reply', reason: 'fallback_no_api_key', message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.' }
  }

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  // ── Intent router ──
  type AgentIntent = 'GREETING' | 'INTRODUCTION' | 'NEGOTIATION' | 'DISPUTE' | 'GENERAL'
  let intent: AgentIntent = 'GENERAL'

  const balance = ctx.verified_debt_data?.current_balance != null ? String(ctx.verified_debt_data.current_balance) : null
  const creditor = ctx.verified_debt_data?.creditor_name ?? null
  const isTelecom = String(ctx.verified_debt_data?.portfolio_category ?? '').toLowerCase() === 'telecom'
  const historyText = chronological.map(h => h.content).join(' ')
  const hasMentionedDebt = (balance && historyText.includes(balance)) || (creditor && historyText.includes(creditor))
  // True only on the very first inbound ever (no prior outbound from us yet) —
  // we greet first and bring up the debt only once the customer has replied.
  const isFirstEverContact = chronological.every(h => h.direction !== 'outbound')

  if (!hasMentionedDebt && isFirstEverContact && !signals.angry && !signals.dispute) {
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

  const installmentRule = planActive
    ? '- ✅ يوجد تقسيط معتمد مسبقاً في النظام: أكّد للعميل أن خطته معتمدة واطلب موعد القسط القادم فقط. لا تغيّر شروط الخطة.'
    : '- 🔴 لا يوجد تقسيط معتمد. ممنوع منعاً باتاً أن تقترح أو توافق على أي تقسيط، أو مبلغ شهري/أسبوعي، أو عدد دفعات، أو أي سداد جزئي. لو طلب العميل تقسيطاً قل له فقط: "التقسيط يحتاج موافقة الإدارة وبارفع طلبك" دون ذكر أي رقم أو جدول، واختر action=record_installment_request. اطلب دائماً السداد الكامل أو موعداً للسداد الكامل.'

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
    DISPUTE: `【 مهمتك الآن: فهم الاعتراض، مناقشته، وإقناع العميل — لا تصعيد سريع 】
- العميل غاضب أو ينكر المديونية أو يقول الرقم خطأ أو يقول "معترض" بدون أي تفصيل.
- 🔴 أهم قاعدة: إن لم يذكر العميل سبباً محدداً للاعتراض بعد، فمهمتك الوحيدة الآن سؤاله بوضوح وبأدب عن سبب اعتراضه. ممنوع تأكيد صحة الدين قبل أن يوضّح السبب.
- إن كان غاضباً فقط (بدون سبب واضح): امتص غضبه بكلمة واحدة ثم اسأله عن السبب.
- إذا ذكر سبباً: لا تكتفِ بشرح واحد فقط — **ناقشه وحاوره فعلياً**. وضّح مصدر الدين من ملف القضية، واستمع لردّه، وإن استمر بالشك أعد التوضيح بطريقة أخرى أو بمعلومة إضافية من الملف. هدفك إقناعه بصحة الدين أو الوصول لالتزام واضح منه (سداد أو تقديم إثبات)، وليس فقط شرح واحد وإغلاق الموضوع.
- 🟠 ليس كل اعتراض يُصعَّد للإدارة. لا تختر record_dispute من أول رد. استمر بالنقاش 2-3 ردود على الأقل ما لم يطلب العميل إثباتاً صريحاً منك لا تملكه.
- إن شعرت أن العميل **يماطل أو يرفض عمداً** (يكرر نفس الإنكار دون سبب منطقي جديد، أو يتجاهل أسئلتك المباشرة): لا تصمت ولا تسجّل اعتراضاً تلقائياً — **زِد الضغط المهني**: كن أكثر حزماً، ذكّره بالعواقب (تصعيد قانوني/إدارة) بأدب، واستمر بالمتابعة. الصمت أو إنهاء الحوار بسرعة غير مقبول مع المماطل.
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
- 🔴 قبل أن تقول "لا توجد لدي معلومة" أو "سأرجع للإدارة": راجع "ملف القضية" كاملاً أولاً (الجهة، نوع المنتج، الرصيد، الرقم المرجعي، تاريخ الاستحقاق، ملاحظات لوحة التحكم) — أغلب أسئلة العميل لها جواب فيه. لا تحوّل للإدارة إلا إذا كانت المعلومة غير موجودة فعلاً في الملف أو تحتاج صلاحية إدارية خاصة (مثل تخفيض المبلغ أو إجراء قانوني).
- لو العميل يتجاهل أسئلتك أو يكرر كلاماً عاماً بلا التزام: لا تسكت ولا تنهِ المحادثة — زِد الضغط بلطف واطلب إجابة مباشرة وواضحة.
- 🔴 ممنوع تكرار ذكر المبلغ أو اسم الجهة، اكتفِ بسؤاله عن الخطوة القادمة.`,
  }

  const caseFile = buildCaseFile(ctx)
  const strictRules = Array.isArray(ctx.strict_rules) ? ctx.strict_rules.join('\n') : ''
  const np = ctx.negotiation_profile ?? {}

  // Conversation as real message turns (chronological), capped to last 10.
  const turns = chronological.slice(-10).map(m => ({
    role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }))

  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const todayWeekday = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', weekday: 'long' }).format(new Date())

  const systemPrompt = `أنت "خالد"، محصّل ديون سعودي محترف عمرك 45 سنة. تتحدث بلهجة سعودية بيضاء طبيعية جداً عبر الواتساب، كأنك إنسان حقيقي.

🔴 تاريخ اليوم الحقيقي الآن هو: ${todayStr} (${todayWeekday}) بتوقيت السعودية. استخدم هذا التاريخ فقط كمرجع لأي حساب زمني (كم باقي على موعد، هل الوعد متأخر، حساب شهر/أسبوع من الآن...). لا تخمّن أو تحسب تاريخ اليوم من معلوماتك العامة — اعتمد على هذا التاريخ المعطى لك حرفياً فقط.

═══════════════ القواعد الحرجة (التزم بها حرفياً) ═══════════════
${strictRules}

═══════════════ ملف القضية (راجعه كاملاً قبل أن ترد) ═══════════════
${caseFile}

قراءة سلوك العميل: النوع=${np.behavior_type ?? 'غير محدد'} | الاستراتيجية المقترحة=${np.recommended_strategy ?? 'غير محدد'}

═══════════════ ${intentPrompts[intent].split('\n')[0].replace(/【|】/g, '').trim()} ═══════════════
${intentPrompts[intent]}

═══════════════ قائمة تحقّق إلزامية قبل كل رد ═══════════════
1. اقرأ المحادثة السابقة كاملة: ما آخر سؤال سألته أنت؟ هل أجاب العميل عليه؟ لا تعد طرح سؤال مُجاب.
2. راجع "ما تم الاتفاق عليه": لا تتجاهل وعداً قائماً أو تقسيطاً معتمداً.
3. لا تخترع أي رقم/اسم/تاريخ غير موجود في ملف القضية. لكن قبل أن تقول "ما عندي معلومة" أو "بحوّلها للإدارة"، راجع ملف القضية كاملاً جيداً — أغلب المعلومات (الجهة، المنتج، الرصيد، الرقم المرجعي، التواريخ، الملاحظات) موجودة فيه فعلاً. التحويل للإدارة فقط عند معلومة غير موجودة حقاً في الملف، أو قرار يحتاج صلاحية إدارية (تخفيض، تصعيد قانوني، قبول اعتراض).
4. لا تكرر ذكر المبلغ إلا إذا كان هذا أول تعريف بالمديونية.
5. تكلم كإنسان: لا "عزيزي العميل"، لا "كيف أقدر أخدمك"، لا عبارات آلية.
6. لو وافق العميل على السداد أو سأل "كيف أدفع/وين أحوّل": أعطه طريقة الدفع من "ملف القضية" (الآيبان أو المفوتر) واطلب منه إرسال صورة الإيصال بعد التحويل. لا تخترع آيباناً غير الموجود.
7. الرد جملة أو جملتين كحد أقصى.
8. 🔴 ${prevOutbound.length === 0 ? 'هذه أول رسالة ترسلها لهذا العميل — يجوز ذكر اسمه مرة واحدة فقط هنا.' : 'سبق أن أرسلت لهذا العميل رسائل قبل — ممنوع ذكر اسمه كعادة أو تلطّف في ردك الآن (لا تبدأ الجملة باسمه). الاستثناء الوحيد: لو سألك صريحاً "ايش اسمي" أو "المديونية باسم مين" فاذكر اسمه كإجابة مباشرة على سؤاله فقط، ثم لا تكرره بعد ذلك.'}
9. 🔴 shouldReply=false أو action=silent مسموح فقط إذا كانت رسالة العميل **توديعاً أو شكراً صريحاً واضحاً بلا أي سؤال أو طلب أو شكوى** (مثل "تمام شكراً" أو "خلاص يعطيك العافية"). أي رسالة فيها سؤال، شكوى، اعتراض، طلب، رفض، أو معلومة جديدة — حتى لو قصيرة أو غامضة — **يجب** أن يكون لها رد واضح. لا تستخدم silent أو close_conversation للتهرّب من رسالة صعبة أو غير واضحة؛ اطلب توضيحاً بدلاً من الصمت.
10. 🔴 الحد الأقصى المطلق لأي مهلة أو تأجيل = 30 يوماً من تاريخ اليوم (${todayStr}) ولا يوماً أكثر تحت أي ظرف. إن طلب العميل أكثر من ذلك (شهرين، 3 شهور، أو ما شابه)، فرفضك إلزامي — لا تقل "ما عندي مشكلة" ولا توافق ضمنياً. اعرض عليه مدة أقصر بكثير (أسبوع إلى أسبوعين) وفاوضه نزولاً، ولا توافق على الشهر كاملاً إلا بعد محاولة تقصيره أولاً.
11. 🔴 لا تختار action=record_dispute أبداً في أول رد على كلام فيه اعتراض غامض بلا سبب محدد (راجع تعليمات DISPUTE أعلاه) — اسأل عن السبب أولاً دائماً.
12. 🔴 استخدم أساليب إقناع متنوعة فعلية لا تكرار نفس الجملة: التذكير بالعواقب بأدب، عرض حل وسط، تحديد خطوة صغيرة فورية (صورة إيصال، تاريخ محدد)، الإشارة إلى أن التأخير يزيد تعقيد الملف. إن شعرت أن العميل يرفض أو يماطل عمداً زِد الحزم والضغط ولا تستسلم أو تصمت.
13. 🔴🔴 أهم قاعدة في تسجيل الوعود: اختر action=record_promise فقط إذا ذكر العميل **في رسالته الحالية بالذات** تاريخاً أو وقتاً محدداً وواضحاً للسداد (مثل "بسدد بكرة"، "يوم الخميس"، "نهاية الشهر"، "يوم 25"). احسب التاريخ الدقيق YYYY-MM-DD بالاستناد إلى تاريخ اليوم الحقيقي (${todayStr}) واكتبه في حقل promised_date. ممنوع منعاً باتاً اختيار record_promise أو ذكر "أنت وعدتني" إن لم يذكر العميل تاريخاً بنفسه في هذه المحادثة — حتى لو كانت كلامه يتضمن "بسدد" بلا تاريخ، فهذا نية لا وعد، اطلب منه التاريخ أولاً (action=negotiate) ولا تسجّل أي شيء. لا تخترع promised_date أبداً من عندك.

═══════════════ صيغة الإخراج ═══════════════
أعد JSON فقط بهذا الشكل، بدون أي نص خارجه:
{
  "shouldReply": true,
  "action": "reply|silent|request_proof|request_clarification|negotiate|pressure|close_conversation|record_installment_request|record_promise|record_dispute|human_review",
  "reason": "سبب مختصر",
  "message": "رد الواتساب أو فارغ",
  "promised_date": "YYYY-MM-DD أو null — لا تعبئها إلا مع action=record_promise وبتاريخ ذكره العميل صريحاً الآن"
}

🔴 تذكير أخير لا تنساه: لا تخترع بيانات، لا تكرر سؤالاً مُجاباً، التزم بما اتُّفق عليه، وردك قصير وبشري.`

  const requestedGraceDays = detectRequestedGraceDays(text)
  const disputeReasonGiven = hasSpecificDisputeReason(text)

  const modelId = 'anthropic/claude-sonnet-4'
  let ai
  try {
    ai = await client.chat.completions.create({
      model: modelId,
      temperature: 0.3,
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

  // 3) Never persist a promise the customer didn't actually give a date
  // for — this is the exact bug that caused the agent to later accuse
  // first-time customers of "promises" they never made. Require BOTH a
  // valid YYYY-MM-DD from the model AND a date-like signal in the
  // customer's own current message before trusting it.
  if (parsed.action === 'record_promise') {
    const validDate = parsed.promised_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.promised_date)
    const customerGaveDateSignal = hasAny(text, [
      'بكرة', 'بكره', 'تومورو', 'tomorrow', 'الخميس', 'الجمعة', 'السبت', 'الأحد', 'الاحد',
      'الإثنين', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الاربعاء', 'نهاية الشهر', 'اخر الشهر', 'آخر الشهر',
      'يوم', 'تاريخ', 'الراتب',
    ]) && /\d/.test(text) || hasAny(text, ['بكرة', 'بكره', 'tomorrow', 'الخميس', 'الجمعة', 'السبت', 'الأحد', 'الاحد', 'الإثنين', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الاربعاء', 'نهاية الشهر', 'اخر الشهر', 'آخر الشهر'])
    if (!validDate || !customerGaveDateSignal) {
      log.warn('fabricated promise guard fired — no real date from customer', { intent, original_date: parsed.promised_date, customer_text: text.slice(0, 80) })
      parsed.message = 'تمام، بس عشان أسجلها — إيش التاريخ بالضبط اللي تقدر تسدد فيه؟'
      parsed.action = 'negotiate'
      parsed.reason = 'fabricated_promise_guard_override'
      parsed.promised_date = null
    }
  } else {
    parsed.promised_date = null
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
    const fallbacks = [
      'طيب، وش تبي نسوي بخصوص الموضوع؟',
      'تمام، خلنا نمشي قدام. وش الخطوة الجاية من عندك؟',
      'فهمت عليك. تبي نتكلم عن طريقة السداد؟',
      'ماشي، بس أبي أعرف متى تقدر تسدد؟',
      'أوكي، بس الموضوع يحتاج حل. متى نتوقع السداد؟',
    ]
    parsed.message = fallbacks[Math.floor(Math.random() * fallbacks.length)]
    parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
    parsed.reason = 'anti_repetition_guard'
  }

  return parsed
}
