import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { generateNegotiationResponse } from '@/lib/negotiation-response'

type HistoryItem = {
  direction: string
  content: string
}

function normalize(text: string) {
  return String(text ?? '').trim().toLowerCase()
}

function isClose(text: string) {
  const value = normalize(text)
  return ['تمام', 'تم', 'خلاص', 'اوكي', 'أوكي', 'ok', 'okay', 'شكرا', 'شكراً', 'thanks'].includes(value)
}

function cleanReply(reply: string) {
  return String(reply ?? '')
    .replace(/عزيزي العميل[،,\s]*/g, '')
    .replace(/عميلنا العزيز[،,\s]*/g, '')
    .replace(/أخوي[،,\s]*/g, '')
    .replace(/نفهم موقفك/g, 'واضح كلامك')
    .replace(/لا تزال قائمة/g, 'لسه ظاهرة عندنا')
    .replace(/سنقوم/g, 'بنقوم')
    .replace(/سيتم/g, 'بنتم')
    .replace(/سوف/g, '')
    .replace(/يرجى/g, '')
    .replace(/نفيدكم/g, '')
    .replace(/نود/g, '')
    .trim()
}

function isRepeated(reply: string, history: HistoryItem[]) {
  const current = reply.replace(/\s+/g, ' ').trim()
  if (!current) return false

  return history
    .filter(m => m.direction === 'outbound')
    .slice(-8)
    .some(m => {
      const old = String(m.content ?? '').replace(/\s+/g, ' ').trim()
      return old && (old.includes(current.slice(0, 40)) || current.includes(old.slice(0, 40)))
    })
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
  if (isClose(text)) return ''

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const negotiation = generateNegotiationResponse(text)

  if (!process.env.OPENAI_API_KEY) {
    return negotiation.response
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.18,
    max_tokens: 380,
    messages: [
      {
        role: 'system',
        content: `
You are the only WhatsApp AI reply engine for a Saudi debt collection system.

Identity:
- You are not a customer service bot.
- You are an experienced Saudi WhatsApp debt collector.
- You read the customer file and continue the same conversation.
- You understand before replying.
- You are short, practical, firm, respectful, and human.

Language:
- If customer writes Arabic, reply only in natural Saudi spoken Arabic.
- Never use formal Arabic.
- Never use robotic or customer-service wording.
- Never write: يرجى, نفيدكم, نود, سيتم, سوف يتم, عزيزي العميل, عميلنا العزيز, شكراً لتواصلك, كيف أقدر أساعدك, يسعدني مساعدتك.
- Never write: نفهم موقفك, لا تزال قائمة, وفقاً, بناءً عليه.
- Use simple Saudi WhatsApp wording like: طيب, واضح, خلّنا نوضحها, المبلغ ظاهر عندنا, بنراجعها, أرسل الإيصال, بنرفعها للمراجعة.

Conversation intelligence:
- Read conversation history before replying.
- Never restart from zero.
- Never repeat the same question.
- Never repeat the same answer.
- If the customer already answered your previous question, move forward.
- If the customer only greets, reply only: وعليكم السلام.
- If the customer closes the conversation, return empty text.
- Ask at most one useful question.
- If no useful reply is needed, return empty text.

Debt handling:
- Use only CUSTOMER_DEBT_CONTEXT.
- Never invent creditor, product, balance, reference, account number, payment link, bank account, or due date.
- If customer asks what the debt is, explain from the available context before asking for payment.
- If context has debt summary, use it naturally.
- If details are missing, say: نراجع تفاصيل الملف ونوضحها لك.
- If customer says paid, ask for receipt only if not already provided.
- If receipt is mentioned or sent, say it will be reviewed.
- If customer says partial payment, treat it as partial claim.
- If customer disputes, respond to the exact objection and ask for proof only when needed.
- If customer asks installments, say it can be raised for review only, do not approve.
- If customer promises payment date, confirm it once and do not ask the same date again.
- If customer is angry, calm briefly and return to file review.

Output:
- Reply with one or two short WhatsApp sentences only.
- No bullet points.
- No explanations about what you are doing.
- Return only the message text or empty text.
        `.trim(),
      },
      {
        role: 'user',
        content: `
CONVERSATION_HISTORY:
${JSON.stringify(history, null, 2)}

LATEST_CUSTOMER_MESSAGE:
${text}

AI_CLASSIFICATION:
Intent: ${negotiation.intent}
Strategy: ${negotiation.strategy}
Tone: ${negotiation.tone}
Draft idea: ${negotiation.response}

CUSTOMER_DEBT_CONTEXT:
${JSON.stringify(debtContext, null, 2)}

Write the best next WhatsApp reply.
        `.trim(),
      },
    ],
  })

  const reply = cleanReply(ai.choices[0]?.message?.content?.trim() ?? negotiation.response)

  if (!reply) return ''
  if (isRepeated(reply, history)) return ''

  return reply
}
