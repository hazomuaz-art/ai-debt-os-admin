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
    | 'explain_debt'
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

function lastOutbound(history: HistoryItem[]) {
  return [...history].reverse().find(m => m.direction === 'outbound')?.content ?? ''
}

function previousOutboundTexts(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'outbound').slice(-6).map(m => String(m.content ?? ''))
}

function isEnglishGreeting(text: string) {
  return /^(hi|hello|hey|good morning|good evening)$/i.test(text.trim())
}

function isEnglishCloser(text: string) {
  return /^(ok|okay|thanks|thank you|done)$/i.test(text.trim())
}

function isRepeated(reply: string, history: HistoryItem[]) {
  const next = reply.replace(/\s+/g, ' ').trim()
  if (!next) return false

  return previousOutboundTexts(history).some(previous => {
    const old = previous.replace(/\s+/g, ' ').trim()
    if (!old) return false
    return old.includes(next.slice(0, 35)) || next.includes(old.slice(0, 35))
  })
}

function isRobotic(reply: string) {
  return includesAny(reply, [
    'dear customer',
    'how can i help',
    'i am here to help',
    'thank you for contacting',
    'customer service',
    'payment plan',
    'installment plan',
  ])
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

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const customerBrain = buildCustomerBrain(debtContext)

  if (isEnglishCloser(text)) {
    return { shouldReply: false, action: 'close_conversation', reason: 'customer_closed_chat', message: '' }
  }

  if (isEnglishGreeting(text) && history.length <= 2) {
    return { shouldReply: true, action: 'reply', reason: 'fresh_greeting', message: 'Hello' }
  }

  if (!process.env.OPENAI_API_KEY) {
    return {
      shouldReply: true,
      action: 'human_review',
      reason: 'fallback_no_openai',
      message: 'تم استلام رسالتك، وبنراجع الملف ونرد عليك بالإجراء المناسب.',
    }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.22,
    max_tokens: 280,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
You are a senior Saudi debt collector on WhatsApp.

Main rule:
Do not ask for payment before explaining the debt if the customer asks what the debt is, why they owe it, what amount, what company, or where the claim came from.

Conversation order:
1. If customer asks about debt reason/source/details:
   Explain using available debt context: creditor, product_type, account_number, reference_number, balance.
   If some details are missing, say only what is available and offer review.
   Do NOT ask "when can you pay" in this reply.
2. If customer answers a previous question:
   Do not repeat the same question.
   Move forward based on their answer.
3. If customer says paid:
   Ask for receipt if not already received.
   If receipt was already mentioned, say it will be reviewed.
4. If customer disputes:
   Handle the specific reason.
   Do not keep asking "what is the reason" after they already gave a reason.
5. If customer promises a date:
   Confirm the promise once.
   Do not ask the same date question again.
6. If customer asks for installments:
   Record request for review only. Do not approve, reject, or offer a plan.
7. If customer is just closing the chat or acknowledging:
   shouldReply=false.
8. If customer is angry:
   Calm briefly, then return to the file.

Style:
- If Arabic, reply in natural Saudi Arabic.
- Short: one or two sentences.
- No formal Arabic.
- No customer-service language.
- No robotic phrases.
- No "dear customer".
- No "how can I help".
- No "I am here to help".
- Do not mention the amount every time.
- Ask only one useful question when needed.

Return JSON only:
{
  "shouldReply": true,
  "action": "reply|silent|request_proof|request_clarification|explain_debt|negotiate|pressure|close_conversation|record_installment_request|record_promise|record_dispute|human_review",
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

Last agent message:
${lastAgentMessage}

Conversation history:
${JSON.stringify(history, null, 2)}

Customer Brain:
${JSON.stringify(customerBrain, null, 2)}

Debt Context:
${JSON.stringify(debtContext?.summary ?? {}, null, 2)}

Full Context:
${JSON.stringify(debtContext, null, 2)}

Important:
If the customer says something like "what amount?", "debt for what?", "from where?", "why do I owe this?", explain the debt first. Do not ask when they will pay.
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
      action: 'human_review',
      reason: 'invalid_ai_json',
      message: 'تم استلام رسالتك، وبنراجع الملف ونرد عليك بالإجراء المناسب.',
    }
  }

  parsed.message = String(parsed.message ?? '').trim()

  if (!parsed.shouldReply || !parsed.message) {
    return { ...parsed, shouldReply: false, message: '' }
  }

  if (isRepeated(parsed.message, history) || isRobotic(parsed.message)) {
    return {
      shouldReply: false,
      action: 'silent',
      reason: 'blocked_repeated_or_robotic_reply',
      message: '',
    }
  }

  return parsed
}