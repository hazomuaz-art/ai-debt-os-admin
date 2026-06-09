import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'

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
    | 'human_review'
  reason: string
  message: string
}

type HistoryItem = {
  direction: string
  content: string
}

function isConversationCloser(text: string) {
  return /^(تمام|تم|اوكي|أوكي|ok|okay|خلاص|ماشي|طيب|يعطيك العافية|شكرا|شكراً|اشكرك)$/i.test(text.trim())
}

function isGreeting(text: string) {
  return /^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا|هاي|hi|hello)$/i.test(text.trim())
}

function cleanReply(reply: string) {
  return reply
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
    .map(m => m.content)

  const core = reply.replace(/\s+/g, ' ').slice(0, 35)
  if (!core) return false

  return previous.some(p => p.includes(core) || core.includes(p.replace(/\s+/g, ' ').slice(0, 35)))
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

  if (!process.env.OPENAI_API_KEY) {
    return {
      shouldReply: true,
      action: 'reply',
      reason: 'fallback_no_openai',
      message: 'وصلتني ملاحظتك، بنمشي فيها بخطوة واضحة حسب الملف.',
    }
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.42,
    max_tokens: 260,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
أنت عقل محصل ديون سعودي محترف، تدير حوار واتساب حقيقي.
مهمتك ليست الرد فقط، بل اتخاذ قرار: هل ترد؟ هل تسكت؟ هل تطلب إثبات؟ هل تضغط؟ هل تطلب توضيح؟ هل تنهي الحوار؟

تصرف كشخص حقيقي:
- لا تكرر نفس السؤال.
- لا تكرر نفس المعنى.
- لا تعيد ذكر المبلغ في كل رد.
- لا تبدأ كل مرة من الصفر.
- لا تسأل سؤال جديد إذا آخر رد منك كان سؤال والعميل ما جاوب بوضوح.
- لا تعرض تقسيط أو خطة سداد من نفسك نهائياً.
- إذا طلب العميل تقسيط: قل إن الطلب ينرفع للمراجعة حسب سياسة الجهة، بدون موافقة.
- إذا العميل قال تمام/اوكي/خلاص/يعطيك العافية: لا ترد.
- إذا العميل قال ما عندي/إذا جاتني فلوس/ظروفي: لا تكرر "متى تسدد". حوّل الكلام لخطوة عملية أو التزام واقعي.
- إذا العميل قال المبلغ غلط/ما أعرفها: اطلب سبب الاعتراض أو الإثبات.
- إذا العميل قال سددت/دفعت: اطلب الإيصال.
- إذا العميل يتهرب: وضح أن الملف يحتاج إجراء واضح.
- إذا العميل غاضب: هدّئه بجملة قصيرة ثم رجع للملف.
- لا تستخدم فصحى رسمية.
- لا تستخدم لغة خدمة عملاء.
- لا تستخدم عبارات: أنا هنا للمساعدة، إذا عندك استفسار، كيف أقدر أخدمك، شكراً لتواصلك، عميلنا العزيز.
- لا تستخدم كلمة "أخوي" نهائياً.

اكتب كسعودي طبيعي، مختصر، محترف.
الرد جملة أو جملتين فقط.
إذا الأفضل عدم الرد، أرجع shouldReply=false.

أرجع JSON فقط بهذا الشكل:
{
  "shouldReply": true,
  "action": "reply|silent|request_proof|request_clarification|negotiate|pressure|close_conversation|human_review",
  "reason": "short reason",
  "message": "WhatsApp reply or empty"
}
        `.trim(),
      },
      {
        role: 'user',
        content: `
تاريخ المحادثة:
${JSON.stringify(history, null, 2)}

رسالة العميل الحالية:
${text}

سياق العميل والمديونية:
${JSON.stringify(debtContext, null, 2)}

اتخذ قرار محصل محترف، ثم اكتب الرد المناسب إذا كان لازم ترد.
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
      message: 'وصلتني ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.',
    }
  }

  parsed.message = cleanReply(String(parsed.message ?? ''))

  if (!parsed.shouldReply || !parsed.message.trim()) {
    return { ...parsed, shouldReply: false, message: '' }
  }

  if (looksRobotic(parsed.message) || tooSimilar(parsed.message, history)) {
    const lower = text.toLowerCase()

    if (lower.includes('سددت') || lower.includes('دفعت') || lower.includes('ايصال') || lower.includes('إيصال')) {
      parsed = {
        shouldReply: true,
        action: 'request_proof',
        reason: 'guardrail_payment_claim',
        message: 'أرسل الإيصال هنا، وبنراجع السداد على الملف.',
      }
    } else if (lower.includes('غلط') || lower.includes('اعتراض') || lower.includes('ما اعرف') || lower.includes('ما أعرف')) {
      parsed = {
        shouldReply: true,
        action: 'request_proof',
        reason: 'guardrail_dispute',
        message: 'وضّح لي سبب الاعتراض أو أرسل الإثبات عشان نرفعه للمراجعة.',
      }
    } else if (lower.includes('ما عندي') || lower.includes('فلوس') || lower.includes('ظروف') || lower.includes('اذا جاتني') || lower.includes('إذا جاتني')) {
      parsed = {
        shouldReply: true,
        action: 'negotiate',
        reason: 'guardrail_hardship',
        message: 'فاهم إن عندك ظرف، لكن الملف يحتاج خطوة واضحة. وش أقرب إجراء جاد تقدر تلتزم فيه؟',
      }
    } else {
      parsed = {
        shouldReply: true,
        action: 'pressure',
        reason: 'guardrail_generic',
        message: 'خلنا نمشيها بخطوة واضحة بدل ما يظل الملف مفتوح.',
      }
    }
  }

  return parsed
}
