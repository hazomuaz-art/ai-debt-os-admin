import OpenAI from 'openai'

export type ConversationTurn = {
  direction: 'inbound' | 'outbound'
  content: string
}

export type CollectorBrainInput = {
  message: string
  history: ConversationTurn[]
}

export type CollectorBrainOutput = {
  shouldReply: boolean
  reply: string
  intent: string
  action: string
  confidence: number
}

function isCloser(text: string) {
  const value = text.trim().toLowerCase()

  return [
    'تمام',
    'تم',
    'خلاص',
    'اوكي',
    'أوكي',
    'ok',
    'okay',
    'شكرا',
    'شكراً',
    'thanks',
  ].includes(value)
}

function isGreeting(text: string) {
  const value = text.trim().toLowerCase()

  return (
    value.includes('السلام') ||
    value.includes('سلام') ||
    value.includes('مرحبا') ||
    value.includes('هلا') ||
    value.includes('مساء الخير') ||
    value.includes('صباح الخير') ||
    value === 'hi' ||
    value === 'hello'
  )
}

function detectIntent(text: string) {
  const value = text.toLowerCase()

  if (isGreeting(text)) return 'greeting'
  if (isCloser(text)) return 'close'

  if (
    value.includes('سددت') ||
    value.includes('دفعت') ||
    value.includes('حولت') ||
    value.includes('إيصال') ||
    value.includes('ايصال')
  ) {
    return 'payment_claim'
  }

  if (
    value.includes('تقسيط') ||
    value.includes('أقساط') ||
    value.includes('اقساط')
  ) {
    return 'installment_request'
  }

  if (
    value.includes('حقت شنو') ||
    value.includes('وش المديونية') ||
    value.includes('سبب المديونية') ||
    value.includes('المبلغ وش')
  ) {
    return 'debt_explanation'
  }

  if (
    value.includes('بسدد') ||
    value.includes('نهاية الشهر') ||
    value.includes('بكرة') ||
    value.includes('الراتب')
  ) {
    return 'promise_to_pay'
  }

  return 'general'
}

function buildDecision(intent: string): CollectorBrainOutput {
  switch (intent) {
    case 'greeting':
      return {
        shouldReply: true,
        reply: 'هلا، وصلتني رسالتك.',
        intent,
        action: 'reply',
        confidence: 0.9,
      }

    case 'close':
      return {
        shouldReply: false,
        reply: '',
        intent,
        action: 'silent',
        confidence: 1,
      }

    case 'payment_claim':
      return {
        shouldReply: true,
        reply: 'أرسل الإيصال وبنراجعه على الملف.',
        intent,
        action: 'request_receipt',
        confidence: 0.9,
      }

    case 'installment_request':
      return {
        shouldReply: true,
        reply: 'طلب التقسيط بنرفعه للمراجعة ونفيدك بالنتيجة.',
        intent,
        action: 'record_installment_request',
        confidence: 0.9,
      }

    case 'debt_explanation':
      return {
        shouldReply: true,
        reply: 'بنعرض لك تفاصيل المديونية من الملف ونوضح سبب المطالبة.',
        intent,
        action: 'explain_debt',
        confidence: 0.9,
      }

    case 'promise_to_pay':
      return {
        shouldReply: true,
        reply: 'تم تسجيل الوعد بالسداد.',
        intent,
        action: 'record_promise',
        confidence: 0.9,
      }

    default:
      return {
        shouldReply: true,
        reply: 'وصلت رسالتك وبنراجع الملف.',
        intent,
        action: 'reply',
        confidence: 0.5,
      }
  }
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

  const intent = detectIntent(message)

  return buildDecision(intent)
}