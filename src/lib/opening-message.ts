import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { createLogger } from '@/lib/logger'

const log = createLogger('opening-message')

// Generates a first-contact WhatsApp opening message for a customer,
// using the same persona/rules as the collector agent. Returns plain text
// (not sent — the caller previews/edits then sends).
export async function generateOpeningMessage(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
}): Promise<string> {
  const ctx = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const c = ctx.verified_customer_data ?? {}
  const d = ctx.verified_debt_data ?? {}
  const name = c.customer_name ? ` ${String(c.customer_name).split(' ')[0]}` : ''

  const fallback = `السلام عليكم${name}، معك خالد. كيف حالك؟`

  if (!process.env.OPENROUTER_API_KEY) {
    return fallback
  }

  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  const strictRules = Array.isArray(ctx.strict_rules) ? ctx.strict_rules.join('\n') : ''
  const money = (v: any) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : `${Number(v).toLocaleString('en-US')} ${d.currency || 'SAR'}`

  const facts = [
    c.customer_name ? `اسم العميل: ${c.customer_name}` : null,
    d.creditor_name ? `الجهة الدائنة: ${d.creditor_name}` : null,
    money(d.current_balance) ? `الرصيد المستحق: ${money(d.current_balance)}` : null,
  ].filter(Boolean).join('\n')

  const systemPrompt = `أنت "خالد"، محصّل ديون سعودي محترف بلهجة سعودية بيضاء طبيعية عبر الواتساب.

═══ القواعد الحرجة ═══
${strictRules}

═══ بيانات مؤكدة (لا تخترع غيرها) ═══
${facts || 'لا توجد بيانات كافية'}

═══ المهمة ═══
اكتب رسالة افتتاح أولى لبدء محادثة واتساب مع هذا العميل (لم تتواصل معه من قبل إطلاقاً):
- ابدأ بتحية مناسبة (السلام عليكم) واذكر اسمه مرة واحدة إن وُجد.
- عرّف نفسك باسم خالد فقط، بدون ذكر "قسم التحصيل" ولا أي كلمة تتعلق بالديون.
- 🔴 ممنوع تماماً ذكر المديونية أو المبلغ أو الجهة الدائنة في هذه الرسالة. هذه رسالة ترحيب فقط — سيأتي ذكر الدين في الرد التالي بعد أن يرد العميل.
- اسأله سؤالاً عاماً لطيفاً (مثل: كيف حالك) فقط.
- سطر واحد قصير، طبيعي وبشري، بدون "عزيزي العميل".
أعِد نص الرسالة فقط بدون أي شرح أو علامات اقتباس.`

  try {
    const ai = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4',
      temperature: 0.4,
      max_tokens: 180,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'اكتب رسالة الافتتاح الآن.' },
      ],
    })
    const text = (ai.choices[0]?.message?.content ?? '').trim().replace(/^["'«]|["'»]$/g, '').trim()
    return text.length > 1 ? text : fallback
  } catch (err: any) {
    log.error('opening message generation failed', { error: String(err?.message ?? err) })
    return fallback
  }
}
