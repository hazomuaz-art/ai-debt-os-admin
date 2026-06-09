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

  if (/^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا|هاي|hi|hello)$/i.test(text)) {
    return 'وعليكم السلام'
  }

  const negotiation = generateNegotiationResponse(text)
  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const history = args.conversation_history ?? []
  const fallback = negotiation.response

  if (!process.env.OPENAI_API_KEY) return fallback

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const ai = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.45,
    max_tokens: 220,
    messages: [
      {
        role: 'system',
        content: `
أنت محصل سعودي حقيقي على واتساب، مو بوت ومو خدمة عملاء.
تتكلم طبيعي جداً مثل موظف تحصيل محترف، بدون فصحى رسمية وبدون عبارات آلية.

مهم جداً:
- اقرأ تاريخ المحادثة قبل الرد.
- لا تكرر نفس السؤال إذا سألته قبل.
- لا تكرر مبلغ المديونية في كل رسالة.
- لا تبدأ كل رد بكلمة "أخوي".
- لا تسأل "متى تسدد؟" إذا العميل قال ما عنده وقت أو ينتظر فلوس.
- لا تكرر نفس الفكرة بصياغة مختلفة.
- لا تستخدم: أنا هنا للمساعدة، إذا عندك استفسار، كيف أقدر أخدمك، شكراً لتواصلك.
- لا تتصرف كاستبيان.
- قُد الحوار كمحصل: وضّح، اضغط بهدوء، اطلب إثبات، اقترح خطوة عملية.
- إذا العميل قال ما عنده فلوس، لا تكرر السؤال. انتقل لفهم القدرة أو طلب التزام واقعي.
- إذا قال المبلغ غلط، لا تعيد المبلغ. اطلب سبب الاعتراض أو الإثبات.
- إذا قال دفعت، اطلب الإيصال.
- إذا قال إذا جاتني فلوس، اطلب منه تحديد أقرب فرصة واقعية أو أقل مبلغ يقدر يبدأ فيه.
- إذا كان متوتر أو معصب، هدئه بجملة قصيرة ثم ارجع للموضوع.
- الرد يكون طبيعي وقصير: جملة أو جملتين.
- لا تسأل إلا سؤال واحد عند الضرورة.
        `.trim(),
      },
      {
        role: 'user',
        content: `
آخر محادثة:
${JSON.stringify(history, null, 2)}

رسالة العميل الآن:
${text}

تصنيف داخلي:
Intent: ${negotiation.intent}
Strategy: ${negotiation.strategy}
Tone: ${negotiation.tone}
Goal: ${(negotiation as any).goal ?? ''}

سياق العميل والمديونية:
${JSON.stringify(debtContext, null, 2)}

اكتب رد واحد طبيعي كمحصل سعودي محترف. لا تكرر الكلام السابق.
        `.trim(),
      },
    ],
  })

  return ai.choices[0]?.message?.content?.trim() || fallback
}
