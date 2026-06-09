import OpenAI from 'openai'

export type ConversationTurn = {
  direction: 'inbound' | 'outbound'
  content: string
}

export type CollectorBrainInput = {
  message: string
  history: ConversationTurn[]
  customerContext?: unknown
  debtContext?: unknown
}

export type CollectorBrainOutput = {
  shouldReply: boolean
  reply: string
  intent: string
  action: string
  confidence: number
}

export async function runCollectorConversationBrain(
  input: CollectorBrainInput
): Promise<CollectorBrainOutput> {
  const message = input.message.trim()

  if (!message) {
    return {
      shouldReply: false,
      reply: '',
      intent: 'empty',
      action: 'silent',
      confidence: 1,
    }
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      shouldReply: true,
      reply: 'وصلت رسالتك، بنراجع الملف ونرد عليك.',
      intent: 'fallback',
      action: 'human_review',
      confidence: 0.4,
    }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.18,
    max_tokens: 350,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
You are a senior Saudi debt collector, not a chatbot and not customer service.

Understand the full conversation before replying.
Do not restart from zero.
Do not repeat the same question.
Do not repeat the same answer.
Do not use formal Arabic.
Reply only in natural spoken Saudi Arabic.
Do not use robotic phrases.
Do not use "dear customer", "how can I help", "I am here to help", or similar.
Do not ask for payment before explaining the debt if the customer asks about the amount, source, or reason.
Use only the provided customer and debt context. Never invent details.
If details are missing, say the file needs review.
If customer promises a payment date, record it and do not ask the same question again.
If customer says paid, ask for receipt only if not already provided.
If receipt is mentioned, say it will be reviewed and do not mark the debt as closed.
If customer asks for installments, record it for review only.
If customer is angry, calm briefly and return to the file.
If customer closes the conversation, do not reply.

Return JSON only:
{
  "shouldReply": true,
  "reply": "short WhatsApp reply or empty",
  "intent": "short_intent",
  "action": "reply|silent|explain_debt|record_promise|request_receipt|record_dispute|record_installment_request|human_review",
  "confidence": 0.9
}
        `.trim(),
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            currentMessage: input.message,
            conversationHistory: input.history,
            customerContext: input.customerContext ?? null,
            debtContext: input.debtContext ?? null,
          },
          null,
          2
        ),
      },
    ],
  })

  try {
    const parsed = JSON.parse(ai.choices[0]?.message?.content ?? '{}') as Partial<CollectorBrainOutput>

    return {
      shouldReply: Boolean(parsed.shouldReply),
      reply: String(parsed.reply ?? '').trim(),
      intent: String(parsed.intent ?? 'unknown'),
      action: String(parsed.action ?? 'reply'),
      confidence: Number(parsed.confidence ?? 0.5),
    }
  } catch {
    return {
      shouldReply: true,
      reply: 'وصلت رسالتك، بنراجع الملف ونرد عليك.',
      intent: 'invalid_json',
      action: 'human_review',
      confidence: 0.3,
    }
  }
}