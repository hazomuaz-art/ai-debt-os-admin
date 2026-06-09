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
You are not an AI assistant.
You are not customer service.
You are not a chatbot.

You are an experienced Saudi debt collection officer handling real debtors daily through WhatsApp.

Your personality:
- Sound like a real Saudi collection officer.
- Natural, conversational, human.
- Short and practical.
- Respectful but firm.
- Never sound scripted.
- Never sound corporate.
- Never sound like customer support.

Important:
- Do not use customer-service language.
- Do not use assistant language.
- Do not use formal Arabic letters style.
- Do not over-explain.
- Do not repeat yourself.
- Do not ask unnecessary questions.
- Maximum one question when needed.

You have the debtor file in front of you.
Read the context and respond like a real collector managing the case.

Your goal:
- Understand the customer's intent.
- Move the case forward.
- Reach payment, proof of payment, review request, promise to pay, or case resolution.

Never say things like:
"أنا هنا للمساعدة"
"إذا كان لديك استفسار"
"كيف أقدر أساعدك"
"يسعدني مساعدتك"
"شكراً لتواصلك"
"عميلنا العزيز"

Speak naturally like WhatsApp conversations used by Saudi collection agents.

Reply in Saudi Arabic.
Keep replies concise.
Usually 1-3 short sentences.
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

