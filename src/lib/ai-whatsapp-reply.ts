import OpenAI from 'openai'
import { generateNegotiationResponse } from '@/lib/negotiation-response'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'

export async function generateWhatsappAutoReply(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  message: string
  conversation_history?: Array<{ direction: string; content: string }>
}) {
  const text = args.message.trim()
  const history = args.conversation_history ?? []
  const lastOutbound = history.filter(m => m.direction === 'outbound').slice(-3).map(m => m.content).join(' | ')

  if (/^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا|هاي|hi|hello)$/i.test(text)) {
    return 'وعليكم السلام'
  }

  if (/^(تمام|تم|اوكي|أوكي|ok|okay|خلاص|ماشي|طيب|يعطيك العافية|شكرا|شكراً)$/i.test(text)) {
    return ''
  }

  const negotiation = generateNegotiationResponse(text)
  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  if (!process.env.OPENAI_API_KEY) {
    return 'وصلتني ملاحظتك، بعتمدها على الملف ونمشي بالإجراء المناسب.'
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.55,
    max_tokens: 180,
    messages: [
      {
        role: 'system',
        content: `
أنت موظف تحصيل سعودي حقيقي على واتساب. لا تكتب كروبوت ولا خدمة عملاء.

ممنوع:
- لا تعرض خطة سداد أو تقسيط أو دفعات من نفسك.
- لا تقول "نرتب لك خطة سداد".
- لا تكرر مبلغ المديونية إذا ذكرته قبل.
- لا تكرر نفس السؤال.
- لا تبدأ بأخوي.
- لا تسأل أسئلة كثيرة.
- لا تستخدم فصحى رسمية.
- لا تستخدم عبارات خدمة العملاء.

المطلوب:
- افهم آخر المحادثة.
- رد كإنسان طبيعي مختصر.
- اضغط بهدوء بدون تهديد.
- لو العميل يقول ما عنده فلوس: لا تعرض تقسيط، اطلب موقف واضح أو إثبات ظرف أو أقرب إجراء جاد.
- لو يقول المبلغ غلط: اطلب سبب الاعتراض أو الإثبات بدون تكرار المبلغ.
- لو يقول سددت: اطلب الإيصال.
- لو يتهرب: لا تلاحقه بسؤال مكرر، وضح إن الملف يحتاج إجراء واضح.

اكتب جملة أو جملتين فقط.
        `.trim(),
      },
      {
        role: 'user',
        content: `
تاريخ المحادثة:
${JSON.stringify(history, null, 2)}

رسالة العميل الآن:
${text}

التصنيف:
${JSON.stringify(negotiation, null, 2)}

سياق الملف:
${JSON.stringify(debtContext, null, 2)}

اكتب رد محصل سعودي طبيعي بدون تكرار وبدون عرض تقسيط.
        `.trim(),
      },
    ],
  })

  let reply = ai.choices[0]?.message?.content?.trim() || ''

  const robotic = [
    'خطة سداد',
    'نرتب لك',
    'نقدر نرتب',
    'أخوي',
    'إذا عندك استفسار',
    'أنا هنا للمساعدة',
    'كيف أقدر',
    'هل تقدر',
    'متى تقدر',
  ]

  const repeated = lastOutbound && reply && lastOutbound.includes(reply.slice(0, 25))

  if (!reply || repeated || robotic.some(x => reply.includes(x))) {
    if (text.includes('غلط') || text.includes('مو صحيح')) {
      reply = 'تمام، وضّح لي سبب الاعتراض أو أرسل الإثبات عشان نرفعه للمراجعة.'
    } else if (text.includes('ما عندي') || text.includes('فلوس') || text.includes('مشغول')) {
      reply = 'واضح إن عندك ظرف، لكن الملف ما ينقفل بدون إجراء واضح. عطنا أقرب حل جاد تقدر تلتزم فيه.'
    } else if (text.includes('سددت') || text.includes('دفعت')) {
      reply = 'أرسل الإيصال هنا، وبنراجع حالة السداد على الملف.'
    } else {
      reply = 'وصلت ملاحظتك. نحتاج نمشي بخطوة واضحة عشان ما يظل الملف مفتوح.'
    }
  }

  return reply
}


