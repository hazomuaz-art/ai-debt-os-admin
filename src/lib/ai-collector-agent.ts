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

function isCloser(text: string) {
  return /^(تمام|تم|اوكي|أوكي|ok|okay|خلاص|ماشي|طيب|يعطيك العافية|شكرا|شكراً|thanks|thank you)$/i.test(text.trim())
}

function isGreeting(text: string) {
  const normalized = text.trim().toLowerCase()
  const greetingRegex = /^(السلام|سلام|هلا|مرحبا|هاي|hi|hello|مساء|صباح|يسعد|يا هلا|أهلين|اهلين|كيف|شلونك|اخبارك|كيفك).*/i
  const businessRegex = /(سدد|رقم|مبلغ|ريال|فاتورة|اقساط|قسط|راتب|تحويل|خصم|بنك|رسالة|شركة|مديونية|دين|حساب|أدفع|ادفع|فلوس|صعب|ظروف)/i
  return greetingRegex.test(normalized) && normalized.length <= 40 && !businessRegex.test(normalized)
}

function cleanReply(reply: string) {
  return String(reply ?? '')
    .replace(/أخوي[،,\s]*/g, '')
    .replace(/عزيزي العميل[،,\s]*/g, '')
    .replace(/عميلنا العزيز[،,\s]*/g, '')
    .trim()
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

  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
    return { shouldReply: true, action: 'reply', reason: 'fallback_no_api_key', message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.' }
  }

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined,
  })

  // ── Intent router ──
  type AgentIntent = 'INTRODUCTION' | 'NEGOTIATION' | 'DISPUTE' | 'GENERAL'
  let intent: AgentIntent = 'GENERAL'

  const balance = ctx.verified_debt_data?.current_balance != null ? String(ctx.verified_debt_data.current_balance) : null
  const creditor = ctx.verified_debt_data?.creditor_name ?? null
  const historyText = chronological.map(h => h.content).join(' ')
  const hasMentionedDebt = (balance && historyText.includes(balance)) || (creditor && historyText.includes(creditor))

  if (!hasMentionedDebt && chronological.length <= 3 && !signals.angry && !signals.dispute) {
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
    INTRODUCTION: `【 مهمتك الآن: التقديم 】
- تتحدث مع العميل لأول مرة. عرّفه أنك من طرف الجهة الدائنة بخصوص المديونية القائمة.
- اذكر اسم الجهة والمبلغ مرة واحدة فقط، ثم اسأله مباشرة: متى يقدر يسدد؟
- سؤال واحد فقط، لا أكثر.`,
    DISPUTE: `【 مهمتك الآن: معالجة اعتراض / امتصاص غضب 】
- العميل غاضب أو ينكر المديونية أو يقول الرقم خطأ.
- إن كان غاضباً: امتص غضبه بكلمة واحدة (أقدّر انزعاجك / حقك تزعل) ثم اطلب التهدئة لمراجعة الملف.
- إذا قدّم العميل سبب اعتراض واضح (مثلاً: ما اشتريت، المبلغ غلط، مو أنا): اطلب منه تفاصيل/إثبات مختصر ثم قل له إنك سترفع اعتراضه للإدارة للبتّ فيه، واختر action=record_dispute. لا توافق ولا ترفض الاعتراض من نفسك — القرار للإدارة.
- 🟡 إذا كان هناك اعتراض قيد المراجعة في ملف القضية: طمئن العميل فقط أن ملاحظته تُراجع لدى الإدارة وسيُرد عليه قريباً، ولا تطلب السداد ولا تسجّل اعتراضاً جديداً.
- 🔴 ممنوع منعاً باتاً تكرار ذكر المبلغ الآن. مهمتك معالجة الاعتراض فقط.`,
    NEGOTIATION: `【 مهمتك الآن: التفاوض والوعود 】
- العميل يعطي عذراً أو يطلب أقساطاً أو يعد بالسداد لاحقاً.
- لو أعطى عذراً: تعاطف بكلمة واحدة (الله يعينك / مقدّر ظرفك) ثم اطلب منه تحديد موعد لسداد المبلغ كاملاً.
${installmentRule}
- لو وعد بدون تاريخ: اطلب التاريخ الدقيق.
- 🔴 لا تكرر إجمالي المبلغ، العميل يعرفه. ولا تقترح أي أرقام أقساط من عندك إطلاقاً.`,
    GENERAL: `【 مهمتك الآن: متابعة عامة 】
- رد طبيعي وحازم بناءً على آخر كلام للعميل وما اتُّفق عليه سابقاً.
- لو ذكر أنه سدّد: اطلب الإيصال.
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

  const systemPrompt = `أنت "خالد"، محصّل ديون سعودي محترف عمرك 45 سنة. تتحدث بلهجة سعودية بيضاء طبيعية جداً عبر الواتساب، كأنك إنسان حقيقي.

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
3. لا تخترع أي رقم/اسم/تاريخ غير موجود في ملف القضية. إن لم تجد المعلومة، قل إنك ستراجع الإدارة.
4. لا تكرر ذكر المبلغ إلا إذا كان هذا أول تعريف بالمديونية.
5. تكلم كإنسان: لا "عزيزي العميل"، لا "كيف أقدر أخدمك"، لا عبارات آلية.
6. لو وافق العميل على السداد أو سأل "كيف أدفع/وين أحوّل": أعطه طريقة الدفع من "ملف القضية" (الآيبان أو المفوتر) واطلب منه إرسال صورة الإيصال بعد التحويل. لا تخترع آيباناً غير الموجود.
7. الرد جملة أو جملتين كحد أقصى. لو العميل أنهى النقاش أو ودّعك، اختر action=silent.

═══════════════ صيغة الإخراج ═══════════════
أعد JSON فقط بهذا الشكل، بدون أي نص خارجه:
{
  "shouldReply": true,
  "action": "reply|silent|request_proof|request_clarification|negotiate|pressure|close_conversation|record_installment_request|record_promise|record_dispute|human_review",
  "reason": "سبب مختصر",
  "message": "رد الواتساب أو فارغ"
}

🔴 تذكير أخير لا تنساه: لا تخترع بيانات، لا تكرر سؤالاً مُجاباً، التزم بما اتُّفق عليه، وردك قصير وبشري.`

  const modelId = process.env.OPENROUTER_API_KEY ? 'anthropic/claude-sonnet-4' : 'gpt-4o'
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

  parsed.message = cleanReply(parsed.message)
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
