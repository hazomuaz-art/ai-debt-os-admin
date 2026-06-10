import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'

type HistoryItem = {
  direction: string
  content: string
}

type Decision = {
  shouldReply: boolean
  reply: string
  understanding: string
  nextAction: string
  eventToRecord: string | null
  confidence: number
}

function normalize(text: string) {
  return String(text ?? '').trim().toLowerCase()
}

function isGreetingOnly(text: string) {
  return /^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا|hi|hello)$/i.test(text.trim())
}

function isCloseOnly(text: string) {
  const value = normalize(text)
  return ['تمام', 'تم', 'خلاص', 'اوكي', 'أوكي', 'ok', 'okay', 'شكرا', 'شكراً', 'thanks'].includes(value)
}

function lastOutbound(history: HistoryItem[]) {
  return [...history].reverse().find(m => m.direction === 'outbound')?.content ?? ''
}

function previousOutbound(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'outbound').slice(-10).map(m => String(m.content ?? ''))
}

function looksRepeated(reply: string, history: HistoryItem[]) {
  const current = reply.replace(/\s+/g, ' ').trim()
  if (!current) return false

  return previousOutbound(history).some(oldText => {
    const old = oldText.replace(/\s+/g, ' ').trim()
    return old && (old.includes(current.slice(0, 45)) || current.includes(old.slice(0, 45)))
  })
}

function cleanReply(reply: string) {
  return String(reply ?? '')
    .replace(/عزيزي العميل[،,\s]*/g, '')
    .replace(/عميلنا العزيز[،,\s]*/g, '')
    .replace(/أخوي[،,\s]*/g, '')
    .replace(/كيف أقدر أساعدك[؟?]*/g, '')
    .replace(/كيف نقدر نساعدك[؟?]*/g, '')
    .replace(/شكراً لتواصلك[،,\s]*/g, '')
    .replace(/نفهم موقفك/g, 'واضح كلامك')
    .replace(/لا تزال قائمة/g, 'لسه ظاهرة عندنا')
    .replace(/سنقوم/g, 'بنراجع')
    .replace(/سيتم/g, 'بنتم')
    .replace(/يرجى/g, '')
    .replace(/نفيدكم/g, '')
    .replace(/نود/g, '')
    .trim()
}
function customerSaidNoProof(history: HistoryItem[], current: string) {
  const text = [...history.map(m => m.content), current].join(' ').toLowerCase()
  return (
    text.includes('ما عندي') ||
    text.includes('ماعندي') ||
    text.includes('ما عندي شي') ||
    text.includes('قلت ما عندي') ||
    text.includes('ما عندي إثبات') ||
    text.includes('ما عندي اثبات')
  )
}

function replyAsksForProof(reply: string) {
  const r = normalize(reply)
  return (
    r.includes('إثبات') ||
    r.includes('اثبات') ||
    r.includes('أرسل') ||
    r.includes('ارسل') ||
    r.includes('مستند') ||
    r.includes('دليل')
  )
}

function roboticReply(reply: string) {
  return [
    'نفهم موقفك',
    'لا تزال قائمة',
    'كيف أقدر أساعدك',
    'كيف نقدر نساعدك',
    'يرجى',
    'نفيدكم',
    'نود',
    'سيتم',
    'سوف',
    'عميلنا العزيز',
    'عزيزي العميل',
  ].some(x => reply.includes(x))
}

function forceGuardReply(args: {
  current: string
  history: HistoryItem[]
  reply: string
  debtContext: any
}) {
  const current = normalize(args.current)
  const reply = args.reply.trim()

  if (!reply) return ''

  if (looksRepeated(reply, args.history)) return ''

  if (roboticReply(reply)) return ''

  if (customerSaidNoProof(args.history, args.current) && replyAsksForProof(reply)) {
    return 'طيب واضح إن ما عندك إثبات حالياً، بنرفع ملاحظتك للمراجعة ونوضح لك نتيجة الملف.'
  }

  const customerAskedDebtReason =
    current.includes('حقت') ||
    current.includes('سبب') ||
    current.includes('وش') ||
    current.includes('ايش') ||
    current.includes('تفاصيل') ||
    current.includes('وضح')

  if (customerAskedDebtReason) {
    const summary = args.debtContext?.summary
    const creditor = summary?.creditor_name && summary.creditor_name !== 'Unknown' ? summary.creditor_name : null
    const product = summary?.product_type && summary.product_type !== 'Unknown' ? summary.product_type : null
    const balance = summary?.current_balance
    const currency = summary?.currency ?? 'ريال'

    if (creditor || product || balance) {
      const parts = []
      if (creditor) parts.push(`الجهة ${creditor}`)
      if (product) parts.push(`نوعها ${product}`)
      if (balance) parts.push(`والمبلغ الظاهر ${balance} ${currency}`)
      return `${parts.join('، ')}. إذا فيه نقطة محددة معترض عليها قل لي عليها ونراجعها.`
    }
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
  const lastAgentMessage = lastOutbound(history)

  if (!text) return ''
  if (isCloseOnly(text)) return ''
  if (isGreetingOnly(text)) {
    return text.toLowerCase() === 'hi' || text.toLowerCase() === 'hello'
      ? 'Hello'
      : 'وعليكم السلام'
  }

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  if (!process.env.OPENAI_API_KEY) {
    return 'وصلت رسالتك، بنراجع الملف ونرد عليك.'
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.12,
    max_tokens: 450,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
You are the decision engine for a Saudi debt collection WhatsApp conversation.

You are NOT a scenario bot.
You are NOT a canned reply bot.
You are NOT customer service.

Your job is to understand the whole conversation and decide the next best human collector move.

Think like this:
1. What did the customer mean?
2. What was already asked before?
3. Did the customer already answer?
4. Is the current reply useful or repetitive?
5. Should the collector reply, stay silent, change strategy, escalate, or record something?
6. What is the shortest natural WhatsApp reply?

Core behavior:
- Never restart from zero.
- Never repeat the same question.
- Never repeat the same answer.
- Never keep asking for proof if the customer already said they do not have proof.
- If a strategy fails, change the approach.
- If the customer repeats the same point, acknowledge and move the file forward.
- If the customer asks a question, answer it directly using the file context.
- If the file context is not enough, say the file needs review, not generic support talk.
- If no reply is useful, return shouldReply=false.
- If customer closes the chat, return shouldReply=false.

Language:
- If the customer writes Arabic, reply only in natural Saudi spoken WhatsApp Arabic.
- Never use formal Arabic.
- Never use robotic phrases.
- Never use customer service phrases.
- Never write: يرجى, نفيدكم, نود, سيتم, سوف يتم, عزيزي العميل, عميلنا العزيز, شكراً لتواصلك, كيف أقدر أساعدك, كيف نقدر نساعدك, نفهم موقفك, لا تزال قائمة.
- Use simple collector language like: طيب, واضح, خلّنا, المبلغ ظاهر عندنا, بنراجعها, نرفعها للمراجعة, أرسل الإيصال إذا توفر.

Debt rules:
- Use only CUSTOMER_DEBT_CONTEXT.
- Never invent creditor, amount, product, reference, account number, payment link, bank account, or due date.
- If customer asks what the debt is, explain available file details first.
- If customer disputes the amount and has no proof, do not ask for proof again. Ask what part is wrong or say it will be reviewed.
- If customer says paid, ask for receipt only if not already discussed.
- If customer asks for installments, record review only. Do not approve.
- If customer promises payment, confirm once and do not keep asking.
- If customer is angry, calm briefly and return to the file.

Return JSON only:
{
  "shouldReply": true,
  "reply": "short WhatsApp message or empty",
  "understanding": "what you understood from the customer",
  "nextAction": "reply|silent|explain_debt|change_strategy|request_receipt|record_promise|record_dispute|record_installment_request|human_review",
  "eventToRecord": "promise|dispute|receipt_claim|installment_request|complaint|wrong_number|manual_review_needed|null",
  "confidence": 0.9
}
        `.trim(),
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            latestCustomerMessage: text,
            lastAgentMessage,
            conversationHistory: history,
            customerDebtContext: debtContext,
          },
          null,
          2
        ),
      },
    ],
  })

  let decision: Decision

  try {
    decision = JSON.parse(ai.choices[0]?.message?.content ?? '{}') as Decision
  } catch {
    decision = {
      shouldReply: true,
      reply: 'وصلت ملاحظتك، بنراجع الملف ونمشي بالإجراء المناسب.',
      understanding: 'invalid_json',
      nextAction: 'human_review',
      eventToRecord: 'manual_review_needed',
      confidence: 0.3,
    }
  }

  if (!decision.shouldReply) return ''

  const reply = forceGuardReply({
    current: text,
    history,
    reply: cleanReply(decision.reply),
    debtContext,
  })

  if (!reply) return ''

  return reply
}

