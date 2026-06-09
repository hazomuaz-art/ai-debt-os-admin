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

function normalize(text: string) {
  return String(text ?? '').trim().toLowerCase()
}

function includesAny(text: string, words: string[]) {
  const value = normalize(text)
  return words.some(word => value.includes(word.toLowerCase()))
}

function isConversationCloser(text: string) {
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

function looksRobotic(reply: string) {
  const bad = [
    'أنا هنا للمساعدة',
    'إذا كان لديك أي استفسار',
    'إذا عندك أي استفسار',
    'كيف أقدر أساعدك',
    'كيف أقدر أخدمك',
    'يسعدني مساعدتك',
    'شكراً لتواصلك',
    'عميلنا العزيز',
    'عزيزي العميل',
    'يرجى التكرم',
    'نود إشعاركم',
    'نفيدكم',
    'تم استلام رسالتك',
    'سيتم التعامل معها',
    'خطة سداد',
    'نرتب لك خطة',
    'نقدر نرتب',
  ]

  return bad.some(x => reply.includes(x))
}

function tooSimilar(reply: string, history: HistoryItem[]) {
  const previous = history
    .filter(m => m.direction === 'outbound')
    .slice(-4)
    .map(m => String(m.content ?? '').replace(/\s+/g, ' ').trim())

  const core = reply.replace(/\s+/g, ' ').trim().slice(0, 35)
  if (!core) return false

  return previous.some(p => {
    const previousCore = p.slice(0, 35)
    return previousCore && (p.includes(core) || core.includes(previousCore))
  })
}

function detectLocalSignal(text: string): CollectorDecision | null {
  if (includesAny(text, ['تقسيط', 'اقساط', 'أقساط', 'installment', 'installments'])) {
    return {
      shouldReply: true,
      action: 'record_installment_request',
      reason: 'customer_requested_installment',
      message: 'تم تسجيل طلبك ورفعه للمراجعة حسب سياسة الجهة.',
    }
  }

  if (includesAny(text, ['سددت', 'دفعت', 'حولت', 'ايصال', 'إيصال', 'receipt', 'paid', 'transfer'])) {
    return {
      shouldReply: true,
      action: 'request_proof',
      reason: 'customer_claimed_payment',
      message: 'أرسل الإيصال هنا، وبنراجع السداد على الملف.',
    }
  }

  if (includesAny(text, ['غلط', 'اعتراض', 'مو صحيح', 'ما اعرف', 'ما أعرف', 'not mine', 'wrong amount'])) {
    return {
      shouldReply: true,
      action: 'record_dispute',
      reason: 'customer_disputed_debt',
      message: 'وضح لي سبب الاعتراض أو أرسل الإثبات عشان نرفعه للمراجعة.',
    }
  }

  return null
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

  if (isConversationCloser(text)) {
    return {
      shouldReply: false,
      action: 'close_conversation',
      reason: 'customer_closed_or_acknowledged',
      message: '',
    }
  }

  if (isGreeting(text)) {
    return {
      shouldReply: true,
      action: 'reply',
      reason: 'greeting',
      message: 'وعليكم السلام',
    }
  }

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const customerBrain = buildCustomerBrain(debtContext)
  const localSignal = detectLocalSignal(text)

  if (localSignal) {
    return localSignal
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      shouldReply: true,
      action: 'reply',
      reason: 'fallback_no_openai',
      message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.',
    }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.35,
    max_tokens: 260,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
You are an expert Saudi debt collection agent speaking on WhatsApp.

Core behavior:
- Act like a real professional collector, not a chatbot.
- Understand the full customer history before replying.
- Do not restart the conversation from zero.
- Do not repeat the same question.
- Do not repeat the same answer.
- Do not mention the debt amount in every reply.
- Ask only one useful question when needed.
- Reply in the customer's language.
- If the customer writes Arabic, reply in natural Saudi Arabic, not formal Arabic.
- If the customer writes English, Urdu, or another language, reply in that language.
- Keep the reply short: one or two sentences.
- Do not use customer-service phrases.
- Do not say: I am here to help, how can I help you, dear customer, thank you for contacting us.
- Never offer installments, payment plans, or discounts by yourself.
- If the customer requests installments, do not approve or reject; say the request is recorded for review according to policy.
- If the customer says they paid, ask for the receipt.
- If the customer disputes the debt, ask for the reason or proof.
- If the customer only acknowledges or closes the chat, do not reply.
- If enough context exists, move the conversation forward instead of asking basic questions again.

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
Conversation history:
${JSON.stringify(history, null, 2)}

Current customer message:
${text}

Customer Brain:
${JSON.stringify(customerBrain, null, 2)}

Customer and debt context:
${JSON.stringify(debtContext, null, 2)}

Make the best collector decision and write the WhatsApp reply only if a reply is needed.
        `.trim(),
      },
    ],
  })

  let parsed: CollectorDecision

  try {
    parsed = JSON.parse(ai.choices[0]?.message?.content ?? '{}')
  } catch {
    parsed = {
      shouldReply: true,
      action: 'reply',
      reason: 'invalid_ai_json',
      message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.',
    }
  }

  parsed.message = cleanReply(String(parsed.message ?? ''))

  if (!parsed.shouldReply || !parsed.message.trim()) {
    return { ...parsed, shouldReply: false, message: '' }
  }

  if (looksRobotic(parsed.message) || tooSimilar(parsed.message, history)) {
    return {
      shouldReply: true,
      action: 'pressure',
      reason: 'guardrail_rewrite_needed',
      message: 'خلنا نمشيها بخطوة واضحة بدل ما يظل الملف مفتوح.',
    }
  }

  return parsed
}