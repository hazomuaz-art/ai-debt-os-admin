import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/server'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { calculateDaysOverdue } from '@/lib/utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('campaign-message')

// A name written in Arabic script is essentially always a genuinely
// Arabic-speaking customer; a name written in Latin/other script in this
// company's customer base is, in practice, an expatriate worker (confirmed
// live — names like "ALI MUHAMMADUDDIN MUHAMMADUDDIN" / "ABDUR RASHID" exist
// in the real campaign list) who very likely does not read Arabic. `country`
// on the customer record is NOT a usable signal here — it's always 'SA' for
// every customer in this system (the company's own country, not the
// individual's), confirmed by direct query, not an assumption. English is
// the safest common default for a non-Arabic-script name in a Saudi
// workplace context — better than guessing a specific origin language.
const ARABIC_SCRIPT_RE = /[؀-ۿ]/
function isArabicName(name: string | null | undefined): boolean {
  return !!name && ARABIC_SCRIPT_RE.test(name)
}

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

    const daysOverdue = calculateDaysOverdue((d as any).due_date ?? null)

    const facts = [
      (c as any).customer_name ? `اسم العميل: ${(c as any).customer_name}` : null,
      (d as any).creditor_name ? `الجهة الدائنة: ${(d as any).creditor_name}` : null,
      (d as any).reference_number ? `الرقم المرجعي للملف: ${(d as any).reference_number}` : null,
      money((d as any).current_balance) ? `الرصيد المستحق: ${money((d as any).current_balance)}` : null,
      (d as any).due_date ? `تاريخ الاستحقاق: ${(d as any).due_date}${daysOverdue > 0 ? ` (متأخر ${daysOverdue} يوم)` : ''}` : null,
      caseNote ? `آخر تطور في الحالة: ${caseNote}` : null,
      negotiation?.recommended_strategy ? `الاستراتيجية الموصى بها لهذا العميل: ${negotiation.recommended_strategy}` : null,
      latestScore?.risk_classification ? `تصنيف المخاطر (تحليل AI): ${latestScore.risk_classification}` : null,
      latestScore?.score !== undefined && latestScore?.score !== null ? `درجة السكور: ${latestScore.score}` : null,
    ].filter(Boolean).join('\n')

    const strictRules = Array.isArray(ctx.strict_rules) ? ctx.strict_rules.join('\n') : ''
    // No prior campaign message on record for this customer/debt — this is
    // genuinely their first contact, so the message must lay out the full
    // claim (creditor, amount, reference number, how overdue) instead of the
    // short one-liner used for follow-ups. Owner-specified requirement
    // (2026-07-11): a first message that doesn't state what the claim
    // actually IS gives the recipient no way to verify or act on it.
    const isFirstMessage = !args.avoid_texts?.length
    const avoidBlock = args.avoid_texts?.length
      ? `\n🔴 رسائل حملات سبق إرسالها لهذا العميل — اكتب رسالة مختلفة تماماً عنها (تحية/فتحة مختلفة، ترتيب أفكار مختلف)، لا تعيد نفس الشكل بكلمات مرادفة فقط:\n${args.avoid_texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      : ''

    const client = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
    })

    // Confirmed live production defect (2026-07-11, owner): the model was
    // inventing a fake kunya/nickname ("أبو خالد") not present anywhere in
    // the real customer data — a hallucinated form of address, apparently
    // bleeding in from the collector persona's own name ("خالد") mentioned
    // right next to it in the prompt. Every prompt variant below bans
    // inventing ANY name/nickname/honorific outright — only the real
    // customer_name (or no name-based address at all) is ever allowed.
    const noInventedNameRuleAr = '🔴 ممنوع تماماً اختراع أي كنية أو لقب غير موجود في "اسم العميل" أعلاه (مثل "أبو فلان" أو أي تخمين) — استخدم الاسم الحقيقي المذكور فقط إن وُجد، أو خاطبه مباشرة بدون اسم إطلاقاً إن كان الاسم غير متوفر.'
    const noInventedNameRuleEn = '🔴 Never invent a nickname, title, or honorific not present in "Customer name" above — use the real name given, or address them directly with no name at all if none is available.'

    const hasName = !!(c as any).customer_name
    const firstMessageRuleAr = isFirstMessage
      ? `🔴 هذه أول رسالة لهذا العميل بخصوص هذا الملف — يجب أن تذكر بوضوح: ${hasName ? 'اسم العميل الحقيقي (خاطبه به في التحية مباشرة، إلزامي وليس اختيارياً)، ' : ''}الجهة الدائنة، المبلغ بالضبط، الرقم المرجعي (إن وُجد)، ومنذ متى الدين متأخر. لا تكتفِ بسطر عام؛ العميل يحتاج يعرف تفاصيل المطالبة كاملة ليقدر يتحقق منها ويتصرف. يمكن أن تكون الرسالة 3-4 أسطر إن احتاج الأمر لذكر كل هذا بوضوح، بنفس الأسلوب السعودي الطبيعي.`
      : 'رسالة متابعة قصيرة (سطر إلى سطرين) — العميل already عنده تفاصيل الملف من رسالة سابقة، لا داعي تعيدها كاملة.'
    const firstMessageRuleEn = isFirstMessage
      ? `This is the FIRST message to this customer about this claim — it must clearly state: ${hasName ? "the customer's real name (address them by it directly in the greeting, mandatory, not optional), " : ''}the creditor, the exact amount, the reference number (if available), and how long it has been overdue. Do not send a vague one-liner; the customer needs the full claim details to verify and act on it. The message can run 3-4 short sentences if needed to cover this clearly, in a natural, professional, human tone.`
      : "Short follow-up message (1-2 lines) — the customer already has the claim details from a prior message, no need to restate them in full."

    const arabic = isArabicName((c as any).customer_name)

    const systemPrompt = arabic ? `أنت "خالد"، محصّل ديون سعودي حقيقي تكتب رسالة واتساب لعميل بلهجتك السعودية البيضاء العادية — كأنك إنسان يكتب من جواله، مو نظام ولا شركة.

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
- ${noInventedNameRuleAr}

═══ المهمة ═══
${firstMessageRuleAr}
🔴 ممنوع اختراع أي تفصيل غير موجود أعلاه.
أعِد نص الرسالة فقط بدون أي شرح أو علامات اقتباس.` : `You are "Khalid", a real Saudi debt-collection agent writing a WhatsApp message to a customer who does not read Arabic — write in clear, natural, professional English, like a real person texting from their phone, not a corporate system.

═══ CRITICAL RULES ═══
${strictRules}

═══ Verified facts about THIS customer (never invent anything beyond this) ═══
${facts || 'No sufficient data available for this customer'}

═══ Purpose of this campaign ═══
${CAMPAIGN_PURPOSE[args.campaign_type] ?? 'Campaign message'}
${args.message_template ? `General campaign idea only (do not copy verbatim — personalize it):\n${args.message_template}` : ''}${avoidBlock}

═══ Required style (most important) ═══
🔴🔴 Write in plain, natural, direct English — never stiff corporate/legal phrasing ("please be advised", "kindly settle", "outstanding dues", "at your earliest convenience").
- Use natural phrasing instead: "you've got a balance left", "wanted to sort this out", "when works for you to pay this?", "let me know".
- Simple greeting, no formalities.
- One emoji at most, or none at all.
- ${noInventedNameRuleEn}

═══ Task ═══
${firstMessageRuleEn}
🔴 Never invent any detail not listed above.
Return only the message text, no explanation or quotation marks.`

    const ai = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-5',
      // Raised from 0.4 for more lexical variety across recipients/campaigns
      // — same reasoning as generateProactiveReminder's temperature bump.
      temperature: 0.6,
      // Raised from 220 — a first-contact message now must state the full
      // claim (creditor, amount, reference number, days overdue), which
      // doesn't fit reliably in the old short-follow-up token budget.
      max_tokens: 320,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: arabic ? 'اكتب رسالة الحملة الآن.' : 'Write the campaign message now.' },
      ],
    })
    const text = (ai.choices[0]?.message?.content ?? '').trim().replace(/^["'«]|["'»]$/g, '').trim()
    return text.length > 1 ? text : fallback
  } catch (err: any) {
    log.error('campaign message generation failed — falling back to template', { error: String(err?.message ?? err), customer_id: args.customer_id })
    return fallback
  }
}
