import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'

type HistoryItem = {
  direction: string
  content: string
}

function normalize(text: string) {
  return String(text ?? '').trim().toLowerCase()
}

function hasAny(text: string, words: string[]) {
  const value = normalize(text)
  return words.some(word => value.includes(word.toLowerCase()))
}

function isGreeting(text: string) {
  return hasAny(text, ['السلام', 'سلام', 'هلا', 'مرحبا', 'مساء الخير', 'صباح الخير', 'hi', 'hello'])
}

function isCloser(text: string) {
  const value = normalize(text)
  return ['تمام', 'تم', 'اوكي', 'أوكي', 'ok', 'okay', 'خلاص', 'شكرا', 'شكراً', 'thanks'].includes(value)
}

function asksDebtDetails(text: string) {
  return hasAny(text, [
    'مبلغ وش',
    'مديونية وش',
    'حقت شنو',
    'حقت ايش',
    'من وين',
    'وش المبلغ',
    'ايش المبلغ',
    'سبب المديونية',
    'ما اعرف الجهة',
    'ما أعرف الجهة',
  ])
}

function lastOutbound(history: HistoryItem[]) {
  return [...history].reverse().find(m => m.direction === 'outbound')?.content ?? ''
}

function previousOutbound(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'outbound').slice(-6).map(m => String(m.content ?? ''))
}

function repeated(reply: string, history: HistoryItem[]) {
  const r = reply.replace(/\s+/g, ' ').trim()
  if (!r) return false

  return previousOutbound(history).some(oldText => {
    const old = oldText.replace(/\s+/g, ' ').trim()
    return old && (old.includes(r.slice(0, 35)) || r.includes(old.slice(0, 35)))
  })
}

function clean(reply: string) {
  return String(reply ?? '')
    .replace(/أخوي[،,\s]*/g, '')
    .replace(/عزيزي العميل[،,\s]*/g, '')
    .replace(/عميلنا العزيز[،,\s]*/g, '')
    .trim()
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

  if (isCloser(text)) return ''

  if (isGreeting(text) && history.length <= 2) {
    return 'وعليكم السلام'
  }

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  if (!process.env.OPENAI_API_KEY) {
    return 'وصلت رسالتك، بنراجع الملف ونرد عليك بالإجراء المناسب.'
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.22,
    max_tokens: 280,
    messages: [
      {
        role: 'system',
        content: `
You are a senior Saudi WhatsApp debt collector.

Core rules:
- Understand the full conversation before replying.
- Never restart from zero.
- Never repeat the same question.
- Never repeat the same answer.
- If customer answered your previous question, move forward.
- Do not ask for payment before explaining the debt when customer asks about the amount/source/reason.
- If customer asks "what amount / debt for what / from where", explain using available debt context first.
- If context is missing, say the available file details are limited and it will be reviewed.
- Never invent creditor, amount, account number, reference, due date, payment link, or bank details.
- If customer says paid, ask for receipt unless already mentioned.
- If receipt is mentioned or sent, say it will be reviewed. Do not close the debt automatically.
- If customer says paid partial amount, treat it as partial payment claim, not full settlement.
- If customer disputes, respond to the exact objection, not generic words.
- If customer says account was closed years ago, ask for proof of closure.
- If customer says amount is wrong, ask for supporting proof or reason.
- If customer says no money/hardship, acknowledge and ask for one realistic next step without offering installments.
- Never offer installments or a payment plan yourself.
- If customer requests installments, say the request can be raised for review only.
- If customer promises date like end of month/salary/tomorrow, confirm once and do not ask the same date again.
- If customer is angry or threatens complaint, calm briefly and return to file review.
- If customer says ok/thanks/done/تمام/خلاص, reply empty.
- One useful question maximum.
- Reply in natural Saudi Arabic.
- One or two short sentences.
- No robotic phrases.
- Do not use: "أخوي", "عزيزي العميل", "كيف أقدر أساعدك", "أنا هنا للمساعدة".
        `.trim(),
      },
      {
        role: 'user',
        content: `
Current customer message:
${text}

Last agent message:
${lastAgentMessage}

Conversation history:
${JSON.stringify(history, null, 2)}

Debt context:
${JSON.stringify(debtContext, null, 2)}

Special check:
Customer is asking debt details: ${asksDebtDetails(text) ? 'YES' : 'NO'}

Write only the WhatsApp reply. If no reply is needed, return empty text.
        `.trim(),
      },
    ],
  })

  const reply = clean(ai.choices[0]?.message?.content?.trim() ?? '')

  if (!reply) return ''
  if (repeated(reply, history)) return ''

  return reply
}