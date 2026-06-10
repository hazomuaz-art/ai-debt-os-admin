import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'

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

  return {
    repeatedDispute: disputeCount >= 2,
    repeatedNoProof: noProofCount >= 2,
  }
}

function debtAnswer(debtContext: any) {
  const s = debtContext?.summary ?? {}
  const parts: string[] = []

  if (s.creditor_name && s.creditor_name !== 'Unknown') parts.push(`الجهة ${s.creditor_name}`)
  if (s.product_type && s.product_type !== 'Unknown') parts.push(`نوعها ${s.product_type}`)
  if (s.reference_number && s.reference_number !== 'Unknown') parts.push(`المرجع ${s.reference_number}`)
  if (s.current_balance) parts.push(`والمبلغ الظاهر ${s.current_balance} ${s.currency ?? 'ريال'}`)

  if (!parts.length) {
    return 'تفاصيل سبب المطالبة ما هي واضحة عندي حالياً، بنراجع الملف ونوضحها لك بدل ما أعطيك كلام ناقص.'
  }

  return `${parts.join('، ')}. لو فيه نقطة محددة غير واضحة قل لي عليها ونراجعها.`
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

  if (asksDebtDetails(args.current)) {
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

  if (!process.env.OPENAI_API_KEY) {
    return 'وصلت ملاحظتك، بنراجع الملف ونرد عليك.'
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.08,
    max_tokens: 420,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
You are a Saudi debt collection conversation manager.

Do not act like a scenario bot.
Do not use canned replies.
Understand the full conversation, then decide the next useful move.

Rules:
- Never repeat the same question.
- Never repeat the same request using different wording.
- If customer already said they do not have proof, do not ask for proof again.
- If customer already said the whole claim is wrong, do not keep asking "what part is wrong".
- If the strategy failed, change the strategy.
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
          customerDebtContext: debtContext,
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
