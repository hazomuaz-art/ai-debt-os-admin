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

    const { data: latestScore } = await svc
      .from('ai_scores')
      .select('score, risk_classification, recommended_strategy')
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

    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    const systemPrompt = `أنت "خالد"، محصّل ديون سعودي محترف بلهجة سعودية بيضاء طبيعية عبر الواتساب.

═══ القواعد الحرجة ═══
${strictRules}

═══ بيانات مؤكدة عن هذا العميل تحديداً (لا تخترع غيرها) ═══
${facts || 'لا توجد بيانات كافية عن هذا العميل'}

═══ الغرض من هذه الحملة ═══
${CAMPAIGN_PURPOSE[args.campaign_type] ?? 'رسالة حملة'}
${args.message_template ? `النص المرجعي للحملة (استخدمه كدليل على الأسلوب والغرض العام فقط، ثم خصصه فعلياً لهذا العميل ببياناته أعلاه):\n${args.message_template}` : ''}

═══ المهمة ═══
اكتب رسالة واتساب واحدة قصيرة (سطر إلى سطرين كحد أقصى) موجّهة لهذا العميل بالذات، مبنية على بياناته الحقيقية أعلاه (اسمه، رصيده، آخر تطور في حالته إن وُجد) بدل رسالة عامة تصلح لأي عميل آخر.
🔴 ممنوع اختراع أي تفصيل غير موجود أعلاه — إذا كانت بيانات معينة غير متوفرة، تجاهلها بدل اختراعها.
أعِد نص الرسالة فقط بدون أي شرح أو علامات اقتباس.`

    const ai = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4.6',
      temperature: 0.4,
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
