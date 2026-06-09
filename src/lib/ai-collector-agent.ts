import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { buildCustomerBrain } from '@/lib/customer-brain'

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
  return /^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا|هاي|hi|hello)$/i.test(text.trim())
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

function lastOutbound(history: HistoryItem[]) {
  return [...history].reverse().find(m => m.direction === 'outbound')?.content ?? ''
}

function previousOutboundTexts(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'outbound').slice(-5).map(m => String(m.content ?? ''))
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
    'خطة سداد',
    'نرتب لك',
    'نقدر نرتب',
  ])
}

function isRepeated(reply: string, history: HistoryItem[]) {
  const r = reply.replace(/\s+/g, ' ').trim()
  if (!r) return false
  return previousOutboundTexts(history).some(p => {
    const old = p.replace(/\s+/g, ' ').trim()
    return old && (old.includes(r.slice(0, 35)) || r.includes(old.slice(0, 35)))
  })
}

export async function runCollectorAgent(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  message: string
  conversation_history: HistoryItem[]
}): Promise<CollectorDecision> {
  const text = args.message.trim()
  const history = args.conversation_history ?? []
  const lastAgentMessage = lastOutbound(history)
  const signals = detectSignals(text)

  if (isCloser(text)) {
    return { shouldReply: false, action: 'close_conversation', reason: 'customer_closed_chat', message: '' }
  }

  if (isGreeting(text) && history.length <= 2) {
    return { shouldReply: true, action: 'reply', reason: 'fresh_greeting', message: 'وعليكم السلام' }
  }

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const customerBrain = buildCustomerBrain(debtContext)

  if (!process.env.OPENAI_API_KEY) {
    return { shouldReply: true, action: 'reply', reason: 'fallback_no_openai', message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.' }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.28,
    max_tokens: 260,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
You are a senior Saudi debt collector on WhatsApp with strong conversation skills.

You are NOT a bot and NOT customer service.

Your job:
- Understand the entire conversation before replying.
- Never restart from zero.
- Never repeat the same question.
- Never repeat the same answer.
- If the customer answered your previous question, move forward.
- If the customer gives a reason, acknowledge it and decide the next useful step.
- Do not keep asking for "reason or proof" after the customer already gave a reason.
- Do not mention the amount every time.
- Do not ask multiple questions.
- Reply in the customer's language.
- If Arabic, use natural Saudi Arabic, not formal Arabic.
- Keep it short: one or two human sentences.
- Be firm, calm, persuasive, and professional.
- No robotic phrases.
- No "dear customer", no "how can I help", no "I am here to help".
- Never offer installments or payment plans yourself.
- If customer requests installments: record it for review only, no approval and no rejection.
- If customer says paid: ask for receipt unless receipt was already discussed.
- If customer disputes: handle the specific objection, do not repeat generic dispute wording.
- If customer is angry: calm briefly then move to the file.
- If conversation is done, stay silent.

Return JSON only:
{
  "shouldReply": true,
  "action": "reply|silent|request_proof|request_clarification|negotiate|pressure|close_conversation|record_installment_request|record_promise|record_dispute|human_review",
  "reason": "short reason",
  "message": "WhatsApp reply or empty"
}
        `.trim(),
      },
      {
        role: 'user',
        content: `
Current customer message:
${text}

Detected signals:
${JSON.stringify(signals, null, 2)}

Last agent message:
${lastAgentMessage}

Conversation history:
${JSON.stringify(history, null, 2)}

Customer Brain:
${JSON.stringify(customerBrain, null, 2)}

Full customer/debt context:
${JSON.stringify(debtContext, null, 2)}

Important:
If the last agent message was a question and the customer just answered it, do not ask the same question again. Move the conversation forward naturally.
        `.trim(),
      },
    ],
  })

  let parsed: CollectorDecision

  try {
    parsed = JSON.parse(ai.choices[0]?.message?.content ?? '{}')
  } catch {
    parsed = { shouldReply: true, action: 'reply', reason: 'invalid_json', message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.' }
  }

  parsed.message = cleanReply(parsed.message)

  if (!parsed.shouldReply || !parsed.message.trim()) {
    return { ...parsed, shouldReply: false, message: '' }
  }

  if (isRobotic(parsed.message) || isRepeated(parsed.message, history)) {
    parsed.message = 'وصلت النقطة، بنثبتها على الملف ونمشي بالإجراء المناسب بدل تكرار نفس الكلام.'
    parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
    parsed.reason = 'anti_repetition_guard'
  }

  return parsed
}