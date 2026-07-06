import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/server'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { createLogger } from '@/lib/logger'

const log = createLogger('campaign-message')

const CAMPAIGN_PURPOSE: Record<string, string> = {
  overdue_90: 'تذكير لعميل متأخر أكثر من 90 يوم - نبرة أكثر جدية وحزم دون تهديد',
  pre_salary: 'تذكير ودي قبل موعد الراتب المتوقع',
  post_holiday: 'تذكير بالسداد بعد إجازة أو عطلة',
  settlement: 'عرض تسوية أو تنازل جزئي على الدين',
  reminder: 'تذكير عام بالسداد',
  custom: 'رسالة حملة مخصصة',
}

// Generates a WhatsApp campaign message specific to ONE customer, instead of
// blasting the same campaign.message_template text to everyone regardless of
// their balance, history, or risk profile. Same persona/rules and
// verified-data-only discipline as generateOpeningMessage(), extended with
// this customer's AI score and latest case note so the message reflects
// their actual situation. Falls back to the campaign's plain template on any
// missing data or generation failure — a campaign must never stall because
// personalization failed.
export async function generateCampaignMessage(args: {
  company_id: string
  customer_id: string
  debt_id: string | null
  campaign_type: string
  message_template: string | null
  // Same repetition-risk class as generateProactiveReminder() in
  // ai-whatsapp-reply.ts: a customer enrolled in more than one campaign (or
  // a re-run of the same campaign) could get near-identical AI-personalized
  // text each time, since this function otherwise has zero awareness of
  // what was already sent. Prior campaign message texts for this customer,
  // most recent first.
  avoid_texts?: string[]
}): Promise<string | null> {
  const fallback = args.message_template ?? null
  if (!process.env.OPENROUTER_API_KEY || !args.debt_id) return fallback

  try {
    const svc = createServiceClient()
    const ctx = await buildCustomerDebtContext({
      company_id: args.company_id,
      customer_id: args.customer_id,
      debt_id: args.debt_id,
    })

    const c = ctx.verified_customer_data ?? ({} as Record<string, unknown>)
    const d = ctx.verified_debt_data ?? ({} as Record<string, unknown>)
    const caseNote = (ctx.debt as any)?.metadata?.case_note ?? null
    const negotiation = ctx.negotiation_profile as any

    // company_id scoping added defensively — debt_id here always comes from
    // an already tenant-scoped campaign_send_queue row, so this wasn't
    // directly exploitable, but every other query in this file is scoped and
    // this one shouldn't be the exception.
    const { data: latestScore } = await svc
      .from('ai_scores')
      .select('score, risk_classification, recommended_strategy')
      .eq('company_id', args.company_id)
      .eq('debt_id', args.debt_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const money = (v: unknown) =>
      v === null || v === undefined || v === '' || Number.isNaN(Number(v))
        ? null
        : `${Number(v).toLocaleString('en-US')} ${(d as any).currency || 'SAR'}`

    const facts = [
      (c as any).customer_name ? `اسم العميل: ${(c as any).customer_name}` : null,
      (d as any).creditor_name ? `الجهة الدائنة: ${(d as any).creditor_name}` : null,
      money((d as any).current_balance) ? `الرصيد المستحق: ${money((d as any).current_balance)}` : null,
      (d as any).due_date ? `تاريخ الاستحقاق: ${(d as any).due_date}` : null,
      caseNote ? `آخر تطور في الحالة: ${caseNote}` : null,
      negotiation?.recommended_strategy ? `الاستراتيجية الموصى بها لهذا العميل: ${negotiation.recommended_strategy}` : null,
      latestScore?.risk_classification ? `تصنيف المخاطر (تحليل AI): ${latestScore.risk_classification}` : null,
      latestScore?.score !== undefined && latestScore?.score !== null ? `درجة السكور: ${latestScore.score}` : null,
    ].filter(Boolean).join('\n')

    const strictRules = Array.isArray(ctx.strict_rules) ? ctx.strict_rules.join('\n') : ''
    const avoidBlock = args.avoid_texts?.length
      ? `\n🔴 رسائل حملات سبق إرسالها لهذا العميل — اكتب رسالة مختلفة تماماً عنها (تحية/فتحة مختلفة، ترتيب أفكار مختلف)، لا تعيد نفس الشكل بكلمات مرادفة فقط:\n${args.avoid_texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : ''

    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const systemPrompt = `أنت "خالد"، محصّل ديون سعودي حقيقي تكتب رسالة واتساب لعميل بلهجتك السعودية البيضاء العادية — كأنك إنسان يكتب من جواله، مو نظام ولا شركة.

═══ القواعد الحرجة ═══
${strictRules}

═══ بيانات مؤكدة عن هذا العميل تحديداً (لا تخترع غيرها) ═══
${facts || 'لا توجد بيانات كافية عن هذا العميل'}

═══ الغرض من هذه الحملة ═══
${CAMPAIGN_PURPOSE[args.campaign_type] ?? 'رسالة حملة'}
${args.message_template ? `فكرة عامة للحملة فقط (لا تنسخها — خصّصها للعميل بلهجة طبيعية):\n${args.message_template}` : ''}${avoidBlock}

═══ الأسلوب المطلوب (الأهم) ═══
🔴🔴 اكتب بلهجة سعودية بيضاء عادية طبيعية، كإنسان حقيقي يكتب واتساب — ممنوع منعاً باتاً الفصحى الرسمية أو نبرة الشركات/الروبوت.
- 🚫 ممنوع نهائياً هذي العبارات وأمثالها: "نرجو التكرم"، "نذكّركم"، "نتمنى تسويتها"، "المبلغ المستحق"، "مديونيتكم المستحقة"، "في أقرب وقت"، "للاستفسار تواصل معنا"، "نأمل"، "يرجى"، "التكرم"، أي صيغة جمع رسمية (كم/تكم).
- ✅ بدالها كلام طبيعي مثل: "عندك مبلغ باقي"، "ودّي نخلّص الموضوع"، "متى يناسبك تسدّده؟"، "تقدر تسدّد كم؟"، "خبّرني".
- خاطب العميل بصيغة المفرد (أنت)، لا الجمع الرسمي.
- تحية بسيطة (السلام عليكم / هلا) بدون رسميات، ولا تبدأ بـ"تذكير ودّي".
- إيموجي واحد بحد أقصى، وممكن بدون أي إيموجي.
- ممنوع علامة الشرطة الطويلة "—"؛ اكتب جملتين قصيرتين أو اربطهم بـ"و"/"بس" كأي شخص يكتب واتساب.

═══ المهمة ═══
اكتب رسالة واتساب واحدة قصيرة (سطر إلى سطرين) لهذا العميل بالذات، مبنية على بياناته الحقيقية (اسمه، رصيده) بأسلوب سعودي بشري طبيعي يدفعه يتجاوب.
🔴 ممنوع اختراع أي تفصيل غير موجود أعلاه.
أعِد نص الرسالة فقط بدون أي شرح أو علامات اقتباس.`

    const ai = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4.6',
      // Raised from 0.4 for more lexical variety across recipients/campaigns
      // — same reasoning as generateProactiveReminder's temperature bump.
      temperature: 0.6,
      max_tokens: 220,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'اكتب رسالة الحملة الآن.' },
      ],
    })
    const text = (ai.choices[0]?.message?.content ?? '').trim().replace(/^["'«]|["'»]$/g, '').trim()
    return text.length > 1 ? text : fallback
  } catch (err: any) {
    log.error('campaign message generation failed — falling back to template', { error: String(err?.message ?? err), customer_id: args.customer_id })
    return fallback
  }
}
