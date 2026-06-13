import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import insuranceReasons from './insurance_reasons.json'

type HistoryItem = {
  direction: string
  content: string
}

type Decision = {
  shouldReply: boolean
  reply: string
  nextAction: string
  confidence: number
}

function norm(text: string) {
  return String(text ?? '').trim().toLowerCase()
}

function hasAny(text: string, words: string[]) {
  const v = norm(text)
  return words.some(w => v.includes(w.toLowerCase()))
}

function inboundTexts(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'inbound').map(m => String(m.content ?? ''))
}

function outboundTexts(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'outbound').map(m => String(m.content ?? ''))
}

function lastOutbound(history: HistoryItem[]) {
  return [...history].reverse().find(m => m.direction === 'outbound')?.content ?? ''
}

function isGreetingOnly(text: string) {
  return /^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا|hi|hello)$/i.test(text.trim())
}

function isCloseOnly(text: string) {
  return ['تمام', 'تم', 'خلاص', 'اوكي', 'أوكي', 'ok', 'okay', 'شكرا', 'شكراً', 'thanks'].includes(norm(text))
}

function asksDebtDetails(text: string) {
  return hasAny(text, ['حقت شنو', 'حقت ايش', 'وش المديونية', 'سبب المديونية', 'المبلغ وش', 'تفاصيل', 'من وين', 'وضح'])
}

function disputes(text: string) {
  return hasAny(text, ['غلط', 'مو صحيح', 'ما يخصني', 'ما اعترف', 'اعتراض', 'كلها غلط', 'المبلغ غلط'])
}

function saysNoProof(text: string) {
  return hasAny(text, ['ما عندي', 'ماعندي', 'ما عندي شي', 'ما عندي اثبات', 'ما عندي إثبات', 'قلت ما عندي'])
}


function refusesToPay(text: string) {
  const patterns = [
    '\u0645\u0627 \u0631\u0627\u062d \u0627\u0633\u062f\u062f',
    '\u0645\u0627\u0631\u0627\u062d \u0627\u0633\u062f\u062f',
    '\u0645\u0631\u0627\u062d \u0627\u0633\u062f\u062f',
    '\u0645\u0627 \u0628\u0633\u062f\u062f',
    '\u0645\u0627 \u0627\u062f\u0641\u0639',
    '\u0645\u0627 \u0631\u0627\u062d \u0627\u062f\u0641\u0639',
    '\u0644\u0646 \u0627\u0633\u062f\u062f',
    '\u0645\u0627\u0646\u064a \u0645\u0633\u062f\u062f',
    '\u0645\u0648 \u0645\u0633\u062f\u062f',
    '\u0645\u0627 \u0628\u0633\u0648\u064a \u0633\u062f\u0627\u062f',
    '\u0642\u0644\u062a \u0644\u0643\u0645',
    '\u0642\u0628\u0644 \u0634\u0648\u064a',
  ]
  return hasAny(text, patterns)
}

function courtEscalation(text: string) {
  const patterns = [
    '\u0645\u062d\u0643\u0645\u0647',
    '\u0645\u062d\u0643\u0645\u0629',
    '\u062d\u0648\u0644\u0647\u0627 \u0644\u0644\u0645\u062d\u0643\u0645\u0647',
    '\u062d\u0648\u0644\u0648\u0647\u0627 \u0644\u0644\u0645\u062d\u0643\u0645\u0647',
    '\u0627\u0631\u0641\u0639\u0648\u0647\u0627 \u0644\u0644\u0645\u062d\u0643\u0645\u0647',
    '\u0642\u0636\u064a\u0647',
    '\u0642\u0636\u064a\u0629',
    '\u0633\u0648\u0648\u0627 \u0627\u0644\u0644\u064a \u062a\u0628\u0648\u0646',
  ]
  return hasAny(text, patterns)
}
function askedProofBefore(history: HistoryItem[]) {
  return outboundTexts(history).some(t => hasAny(t, ['أرسل', 'ارسل', 'إثبات', 'اثبات', 'مستند', 'دليل']))
}

function askedClarificationBefore(history: HistoryItem[]) {
  return outboundTexts(history).some(t => hasAny(t, ['وش الجزء', 'شنو الجزء', 'حدد', 'وين الغلط', 'إيش الغلط', 'ايش الغلط']))
}

function repeatedMeaning(current: string, history: HistoryItem[]) {
  const inbounds = inboundTexts(history).slice(-6)
  const disputeCount = inbounds.filter(disputes).length + (disputes(current) ? 1 : 0)
  const noProofCount = inbounds.filter(saysNoProof).length + (saysNoProof(current) ? 1 : 0)
  const refusalCount = inbounds.filter(t => refusesToPay(t) || courtEscalation(t)).length + ((refusesToPay(current) || courtEscalation(current)) ? 1 : 0)

  return {
    repeatedDispute: disputeCount >= 2,
    repeatedNoProof: noProofCount >= 2,
    repeatedRefusal: refusalCount >= 2,
  }
}

function debtAnswer(debtContext: any) {
  const s = debtContext?.summary ?? {}
  const parts: string[] = []

  if (s.portfolio_name && s.portfolio_name !== 'Unknown Portfolio' && s.portfolio_name !== 'Unknown') parts.push(`الجهة ${s.portfolio_name}`)
  else if (s.creditor_name && s.creditor_name !== 'Unknown') parts.push(`الجهة ${s.creditor_name}`)
  
  if (s.reference_number && s.reference_number !== 'Unknown') parts.push(`برقم المطالبة ${s.reference_number}`)
  if (s.current_balance) parts.push(`والمبلغ الظاهر هو ${s.current_balance} ${s.currency ?? 'ريال'}`)

  const extReason = insuranceReasons[s.reference_number] || insuranceReasons[s.account_number]
  if (extReason) {
    return `${parts.join(' ')}. وسبب المطالبة هو مطالبة مالية نتيجة تعويض شركة التأمين للطرف المتضرر في حادث مروري (رقم الحادث: ${s.reference_number}) بتاريخ ${extReason.accidentDate} على المركبة ${extReason.carType}. نسبة الإدانة المسجلة عليك هي ${extReason.faultPercentage}%. السبب الرئيسي لرجوع التأمين عليك هو: ${extReason.reason}.`
  }

  if (!parts.length) {
    return 'تفاصيل المطالبة غير واضحة حالياً، بنراجع الملف ونوضحها لك.'
  }

  return `${parts.join(' ')}. لو فيه نقطة محددة غير واضحة بخصوص التفاصيل المذكورة في الملاحظات بلغني.`
}

function robotic(reply: string) {
  return hasAny(reply, [
    'يرجى',
    'نفيدكم',
    'نود',
    'سيتم',
    'سوف يتم',
    'عزيزي العميل',
    'عميلنا العزيز',
    'شكراً لتواصلك',
    'كيف أقدر أساعدك',
    'كيف نقدر نساعدك',
    'نفهم موقفك',
    'لا تزال قائمة',
  ])
}

function asksSameProof(reply: string) {
  return hasAny(reply, ['أرسل إثبات', 'ارسل اثبات', 'أرسل ما يثبت', 'ارسل ما يثبت', 'مستند', 'دليل'])
}

function asksSameClarification(reply: string) {
  return hasAny(reply, ['وش الجزء', 'شنو الجزء', 'حدد', 'وين الغلط', 'ايش الغلط', 'إيش الغلط'])
}

function clean(reply: string) {
  return String(reply ?? '')
    .replace(/عزيزي العميل[،,\s]*/g, '')
    .replace(/عميلنا العزيز[،,\s]*/g, '')
    .replace(/أخوي[،,\s]*/g, '')
    .replace(/كيف أقدر أساعدك[؟?]*/g, '')
    .replace(/كيف نقدر نساعدك[؟?]*/g, '')
    .replace(/شكراً لتواصلك[،,\s]*/g, '')
    .replace(/نفهم موقفك/g, 'واضح كلامك')
    .replace(/لا تزال قائمة/g, 'لسه ظاهرة عندنا')
    .replace(/سيتم/g, 'بنتم')
    .replace(/سوف يتم/g, 'بنتم')
    .replace(/يرجى/g, '')
    .replace(/نفيدكم/g, '')
    .replace(/نود/g, '')
    .trim()
}

function finalGuard(args: {
  current: string
  history: HistoryItem[]
  reply: string
  debtContext: any
}) {
  const reply = clean(args.reply)
  const repeated = repeatedMeaning(args.current, args.history)

  if (!reply) return ''
  if (robotic(reply)) return ''

  if ((refusesToPay(args.current) || courtEscalation(args.current) || repeated.repeatedRefusal)) {
    return 'واضح إنك رافض السداد حالياً. بنسجل موقفك على الملف ونحوّله للمراجعة بدل ما نكرر نفس الرد عليك.'
  }

  if (asksDebtDetails(args.current)) {
    const alreadyExplainedDebt = outboundTexts(args.history).some(t =>
      t.includes('المبلغ الظاهر') ||
      t.includes('المرجع') ||
      t.includes('الجهة') ||
      t.includes('نوعها')
    )

    if (alreadyExplainedDebt) {
      return 'سبق وضحت لك البيانات الظاهرة عندنا. إذا الاعتراض على أصل المطالبة بنرفعها للمراجعة بدل ما نكرر نفس الكلام.'
    }

    return debtAnswer(args.debtContext)
  }

  if ((saysNoProof(args.current) || repeated.repeatedNoProof) && (askedProofBefore(args.history) || asksSameProof(reply))) {
    return 'طيب واضح إن ما عندك إثبات حالياً، بنسجل الملاحظة ونرفع الملف للمراجعة بدل ما نكرر نفس الطلب.'
  }

  if ((disputes(args.current) || repeated.repeatedDispute) && (askedClarificationBefore(args.history) || asksSameClarification(reply))) {
    return 'وصلت ملاحظتك إن الاعتراض على المطالبة نفسها، بنرفعها للمراجعة ونوضح لك نتيجة الملف.'
  }

  const oldReplies = outboundTexts(args.history).slice(-8).map(t => t.replace(/\s+/g, ' ').trim())
  const current = reply.replace(/\s+/g, ' ').trim()
  if (oldReplies.some(old => old && (old.includes(current.slice(0, 40)) || current.includes(old.slice(0, 40))))) {
    return ''
  }

  return reply
}

export async function generateWhatsappAutoReply(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  message: string
  conversation_history?: HistoryItem[]
}) {
  const text = args.message.trim()
  const history = args.conversation_history ?? []

  if (!text) return ''
  if (isCloseOnly(text)) return ''
  if (isGreetingOnly(text)) {
    return text.toLowerCase() === 'hi' || text.toLowerCase() === 'hello' ? 'Hello' : 'وعليكم السلام'
  }

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const hardReply = finalGuard({
    current: text,
    history,
    reply: asksDebtDetails(text) ? debtAnswer(debtContext) : '',
    debtContext,
  })

  if (hardReply) return hardReply

  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
    return 'وصلت ملاحظتك، بنراجع الملف ونرد عليك.'
  }

  const client = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined
  })

  const ai = await client.chat.completions.create({
    model: process.env.OPENROUTER_API_KEY ? 'google/gemini-2.5-pro' : 'gpt-4o',
    temperature: 0.08,
    max_tokens: 420,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
You are 'Abu Fahad', a 45-year-old Saudi professional debt collection agent with 20 years of experience in Saudi Arabia. Your tone is extremely polite, respectful, and professional (using words like أخوي, يا غالي, بارك الله فيك). You NEVER threaten or use rude language. However, you are firm, serious, and highly skilled in handling evading or stalling clients. You know how to guide the conversation towards payment or extracting a binding 'Promise to Pay'. You adapt dynamically to the client's profile from the database, always referencing their specific debt metadata (Company, Amount) and past conversation notes to prevent repetition.

Do not act like a scenario bot.
Do not use canned replies.
Understand the full conversation, then decide the next useful move.

Rules:
- Before responding, you MUST silently review the customer's profile, prior notes (customer.notes, debt.notes), collection followups, and timeline events provided in the JSON context.
- Act as if you have a perfect long-term memory of all past conversations (conversationHistory) and previous interactions. Never ask for information that is already in the file or was previously stated.
- DO NOT repeat the customer's name during the conversation. Use it ONLY in the very first greeting message.
- ALWAYS clarify the source of the debt using the portfolio_name from the context (e.g. "جهة المديونية هي [portfolio_name]").
- READ the debt details, schedule, and reason from the debt.notes field in the context and explain them clearly to the customer if they ask.
- If the customer's debt has "external_insurance_reason" provided in the JSON context, you MUST explain the detailed reason, accident date, fault percentage, and car type directly from that object if the customer asks for details.
- NEVER mention the product_type (e.g. "حق الرجوع") to the customer under any circumstances. Only refer to the claim number (reference_number).
- NEVER repeat the same question or ask obvious/stupid questions. If the customer evades, change your psychological approach.
- Never repeat the same request using different wording.
- Use smart psychological persuasion techniques to convince the customer to pay without being aggressive.
- Continuously adapt your personality based on the conversation flow. Learn from the customer's excuses and counter them with extreme professionalism and politeness.
- If customer already said they do not have proof, do not ask for proof again.
- If customer already said the whole claim is wrong, do not keep asking "what part is wrong".
- If the strategy failed, gracefully change the strategy.
- Handle any unexpected scenario dynamically with elegance and high taste.
- If the customer asks about debt details, answer from file context first.
- If data is missing, move to review instead of guessing.
- If no useful reply is needed, return shouldReply=false.
- Arabic replies must be Saudi spoken WhatsApp Arabic only.
- No formal Arabic.
- No customer service phrases.

Return JSON only:
{
  "shouldReply": true,
  "reply": "short natural WhatsApp reply",
  "nextAction": "reply|silent|explain_debt|review|record_dispute|record_promise|request_receipt",
  "confidence": 0.9
}
        `.trim(),
      },
      {
        role: 'user',
        content: JSON.stringify({
          latestCustomerMessage: text,
          lastAgentMessage: lastOutbound(history),
          conversationHistory: history,
          customerDebtContext: {
             ...debtContext,
             external_insurance_reason: insuranceReasons[debtContext?.summary?.reference_number] || insuranceReasons[debtContext?.summary?.account_number] || null
          },
        }, null, 2),
      },
    ],
  })

  let decision: Decision

  try {
    decision = JSON.parse(ai.choices[0]?.message?.content ?? '{}') as Decision
  } catch {
    decision = {
      shouldReply: true,
      reply: 'وصلت ملاحظتك، بنراجع الملف ونرد عليك.',
      nextAction: 'review',
      confidence: 0.3,
    }
  }

  if (!decision.shouldReply) return ''

  return finalGuard({
    current: text,
    history,
    reply: decision.reply,
    debtContext,
  })
}




export type WhatsappSystemImpact = {
  timeline: boolean
  memory: boolean
  promise: boolean
  alert: boolean
  approval: boolean
  score: boolean
  ai_action: boolean
  dashboard: boolean
  debt_update: boolean
  customer_update: boolean
  risk_impact: 'decrease' | 'neutral' | 'increase' | 'critical'
  summary: string
}

export type WhatsappOperationalDecision = {
  shouldReply: boolean
  reply: string
  nextAction: string
  confidence: number
  systemImpact: WhatsappSystemImpact
}

export async function generateWhatsappOperationalDecision(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  message: string
  conversation_history?: HistoryItem[]
}): Promise<WhatsappOperationalDecision> {
  const reply = await generateWhatsappAutoReply(args)
  const text = args.message.trim().toLowerCase()

  const isPromise =
    text.includes('بسدد') || text.includes('بسدده') || text.includes('اسدد') ||
    text.includes('بكرة') || text.includes('بكره') ||
    text.includes('نهاية الشهر') || text.includes('اخر الشهر') || text.includes('آخر الشهر')

  const isRefusal =
    text.includes('ما بسدد') || text.includes('ما راح اسدد') ||
    text.includes('ماني مسدد') || text.includes('ارفض') || text.includes('رفض')

  const isDispute =
    text.includes('ما يخصني') || text.includes('مو صحيح') || text.includes('غير صحيح') ||
    text.includes('غلط') || text.includes('اعتراض') || text.includes('رقم غلط')

  const isPaid =
    text.includes('دفعت') || text.includes('سددت') || text.includes('حولت') ||
    text.includes('حوالة') || text.includes('ايصال') || text.includes('إيصال')

  let nextAction = 'reply'
  let risk_impact: WhatsappSystemImpact['risk_impact'] = 'neutral'
  let summary = 'Inbound WhatsApp message requires system-wide update.'

  const systemImpact: WhatsappSystemImpact = {
    timeline: true,
    memory: true,
    promise: false,
    alert: false,
    approval: false,
    score: true,
    ai_action: true,
    dashboard: true,
    debt_update: false,
    customer_update: false,
    risk_impact,
    summary,
  }

  if (isRefusal) {
    nextAction = 'human_review'
    systemImpact.alert = true
    systemImpact.debt_update = true
    systemImpact.risk_impact = 'increase'
    systemImpact.summary = 'Customer refused payment; debt risk should increase.'
  }

  else if (isPromise) {
    nextAction = 'record_promise'
    systemImpact.promise = true
    systemImpact.risk_impact = 'decrease'
    systemImpact.summary = 'Customer gave a payment promise.'
  }

  if (isDispute) {
    nextAction = 'record_dispute'
    systemImpact.alert = true
    systemImpact.approval = true
    systemImpact.debt_update = true
    systemImpact.risk_impact = 'critical'
    systemImpact.summary = 'Customer disputed the debt or identity; review required.'
  }

  if (isPaid) {
    nextAction = 'request_receipt'
    systemImpact.approval = true
    systemImpact.memory = true
    systemImpact.timeline = true
    systemImpact.dashboard = true
    systemImpact.summary = 'Customer claimed payment; receipt/review required.'
  }

  return {
    shouldReply: Boolean(reply),
    reply,
    nextAction,
    confidence: 0.9,
    systemImpact,
  }
}

export async function generateProactiveReminder(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  promise_details: any
}): Promise<string> {
  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id,
  })

  const ai = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined
  })

  const res = await ai.chat.completions.create({
    model: process.env.OPENROUTER_API_KEY ? 'google/gemini-2.5-pro' : 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are "أبو فهد" (Abu Fahad), a 45-year-old professional and respectful Saudi debt collector.
Your task is to send a proactive, friendly reminder to the customer about their promise to pay today.
DO NOT BE AGGRESSIVE. Be very polite, using appropriate Saudi greetings.
The promise details are: ${JSON.stringify(args.promise_details)}.
Mention the promised amount and ask if they have managed to transfer the amount today.
KEEP IT VERY SHORT AND NATURAL. (1-2 sentences).
NEVER mention the internal promise ID.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          customerDebtContext: debtContext
        }, null, 2)
      }
    ]
  })

  return res.choices[0]?.message?.content ?? 'السلام عليكم، للتذكير بموعد السداد المتفق عليه اليوم، طمنا إذا تم الإيداع.'
}
