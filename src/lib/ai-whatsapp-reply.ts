import OpenAI from 'openai'
import { generateNegotiationResponse } from '@/lib/negotiation-response'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'

export async function generateWhatsappAutoReply(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  message: string
}) {
  const text = args.message.trim()

  if (/^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا)$/i.test(text)) {
    return 'وعليكم السلام'
  }

  const negotiation = generateNegotiationResponse(text)

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  let fallback = negotiation.response

  if (!process.env.OPENAI_API_KEY) return fallback

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.35,
    max_tokens: 350,
    messages: [
      {
        role: 'system',
        content: `
You are a Saudi WhatsApp debt collector, not a chatbot.
Reply in natural Saudi Arabic.
Be direct, respectful, firm, and practical.
Do not sound robotic.
Do not ask many questions.
Maximum one question.
Use only the provided customer/debt context.
Never invent creditor, amount, reference number, payment link, bank account, or due date.
If greeting only, reply only: وعليكم السلام
If customer disputes, move to review.
If customer says paid, ask for receipt.
If customer delays, ask for exact date and amount.
If customer asks installments, say it can be raised for review and do not approve directly.
Reply in 1 to 3 short sentences.
        `.trim(),
      },
      {
        role: 'user',
        content: `
CUSTOMER_MESSAGE:
${text}

AI_CLASSIFICATION:
Intent: ${negotiation.intent}
Strategy: ${negotiation.strategy}
Tone: ${negotiation.tone}

CUSTOMER_DEBT_CONTEXT:
${JSON.stringify(debtContext, null, 2)}

Write the WhatsApp reply.
        `.trim(),
      },
    ],
  })

  return ai.choices[0]?.message?.content?.trim() || fallback
}
