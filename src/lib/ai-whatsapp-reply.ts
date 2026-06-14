import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import insuranceReasons from './insurance_reasons.json'

type HistoryItem = {
  direction: string
  content: string
}

type Decision = {
  shouldReply: boolean
  reply: string
  nextAction: string
  confidence: number
}

function norm(text: string) {
  return String(text ?? '').trim().toLowerCase()
}

function hasAny(text: string, words: string[]) {
  const v = norm(text)
  return words.some(w => v.includes(w.toLowerCase()))
}

function inboundTexts(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'inbound').map(m => String(m.content ?? ''))
}

function outboundTexts(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'outbound').map(m => String(m.content ?? ''))
}

function lastOutbound(history: HistoryItem[]) {
  return [...history].reverse().find(m => m.direction === 'outbound')?.content ?? ''
}

function isGreetingOnly(text: string) {
  return /^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا|hi|hello)$/i.test(text.trim())
}

function isCloseOnly(text: string) {
  return ['تمام', 'تم', 'خلاص', 'اوكي', 'أوكي', 'ok', 'okay', 'شكرا', 'شكراً', 'thanks'].includes(norm(text))
}

function asksDebtDetails(text: string) {
  return hasAny(text, ['حقت شنو', 'حقت ايش', 'وش المديونية', 'سبب المديونية', 'المبلغ وش', 'تفاصيل', 'من وين', 'وضح'])
}

function disputes(text: string) {
  return hasAny(text, ['غلط', 'مو صحيح', 'ما يخصني', 'ما اعترف', 'اعتراض', 'كلها غلط', 'المبلغ غلط'])
}

function saysNoProof(text: string) {
  return hasAny(text, ['ما عندي', 'ماعندي', 'ما عندي شي', 'ما عندي اثبات', 'ما عندي إثبات', 'قلت ما عندي'])
}


function refusesToPay(text: string) {
  const patterns = [
    '\u0645\u0627 \u0631\u0627\u062d \u0627\u0633\u062f\u062f',
    '\u0645\u0627\u0631\u0627\u062d \u0627\u0633\u062f\u062f',
    '\u0645\u0631\u0627\u062d \u0627\u0633\u062f\u062f',
    '\u0645\u0627 \u0628\u0633\u062f\u062f',
    '\u0645\u0627 \u0627\u062f\u0641\u0639',
    '\u0645\u0627 \u0631\u0627\u062d \u0627\u062f\u0641\u0639',
    '\u0644\u0646 \u0627\u0633\u062f\u062f',
    '\u0645\u0627\u0646\u064a \u0645\u0633\u062f\u062f',
    '\u0645\u0648 \u0645\u0633\u062f\u062f',
    '\u0645\u0627 \u0628\u0633\u0648\u064a \u0633\u062f\u0627\u062f',
    '\u0642\u0644\u062a \u0644\u0643\u0645',
    '\u0642\u0628\u0644 \u0634\u0648\u064a',
  ]
  return hasAny(text, patterns)
}

function courtEscalation(text: string) {
  const patterns = [
    '\u0645\u062d\u0643\u0645\u0647',
    '\u0645\u062d\u0643\u0645\u0629',
    '\u062d\u0648\u0644\u0647\u0627 \u0644\u0644\u0645\u062d\u0643\u0645\u0647',
    '\u062d\u0648\u0644\u0648\u0647\u0627 \u0644\u0644\u0645\u062d\u0643\u0645\u0647',
    '\u0627\u0631\u0641\u0639\u0648\u0647\u0627 \u0644\u0644\u0645\u062d\u0643\u0645\u0647',
    '\u0642\u0636\u064a\u0647',
    '\u0642\u0636\u064a\u0629',
    '\u0633\u0648\u0648\u0627 \u0627\u0644\u0644\u064a \u062a\u0628\u0648\u0646',
  ]
  return hasAny(text, patterns)
}
function askedProofBefore(history: HistoryItem[]) {
  return outboundTexts(history).some(t => hasAny(t, ['أرسل', 'ارسل', 'إثبات', 'اثبات', 'مستند', 'دليل']))
}

function askedClarificationBefore(history: HistoryItem[]) {
  return outboundTexts(history).some(t => hasAny(t, ['وش الجزء', 'شنو الجزء', 'حدد', 'وين الغلط', 'إيش الغلط', 'ايش الغلط']))
}

function repeatedMeaning(current: string, history: HistoryItem[]) {
  const inbounds = inboundTexts(history).slice(-6)
  const disputeCount = inbounds.filter(disputes).length + (disputes(current) ? 1 : 0)
  const noProofCount = inbounds.filter(saysNoProof).length + (saysNoProof(current) ? 1 : 0)
  const refusalCount = inbounds.filter(t => refusesToPay(t) || courtEscalation(t)).length + ((refusesToPay(current) || courtEscalation(current)) ? 1 : 0)

  return {
    repeatedDispute: disputeCount >= 2,
    repeatedNoProof: noProofCount >= 2,
    repeatedRefusal: refusalCount >= 2,
  }
}

function debtAnswer(debtContext: any) {
  const s = debtContext?.summary ?? {}
  const parts: string[] = []

  if (s.portfolio_name && s.portfolio_name !== 'Unknown Portfolio' && s.portfolio_name !== 'Unknown') parts.push(`الجهة ${s.portfolio_name}`)
  else if (s.creditor_name && s.creditor_name !== 'Unknown') parts.push(`الجهة ${s.creditor_name}`)
  
  if (s.reference_number && s.reference_number !== 'Unknown') parts.push(`برقم المطالبة ${s.reference_number}`)
  if (s.current_balance) parts.push(`والمبلغ الظاهر هو ${s.current_balance} ${s.currency ?? 'ريال'}`)

  const extReason = insuranceReasons[s.reference_number] || insuranceReasons[s.account_number]
  if (extReason) {
    return `${parts.join(' ')}. وسبب المطالبة هو مطالبة مالية نتيجة تعويض شركة التأمين للطرف المتضرر في حادث مروري (رقم الحادث: ${s.reference_number}) بتاريخ ${extReason.accidentDate} على المركبة ${extReason.carType}. نسبة الإدانة المسجلة عليك هي ${extReason.faultPercentage}%. السبب الرئيسي لرجوع التأمين عليك هو: ${extReason.reason}.`
  }

  if (!parts.length) {
    return 'تفاصيل المطالبة غير واضحة حالياً، بنراجع الملف ونوضحها لك.'
  }

  return `${parts.join(' ')}. لو فيه نقطة محددة غير واضحة بخصوص التفاصيل المذكورة في الملاحظات بلغني.`
}

function robotic(reply: string) {
  return hasAny(reply, [
    'يرجى',
    'نفيدكم',
    'نود',
    'سيتم',
    'سوف يتم',
    'عزيزي العميل',
    'عميلنا العزيز',
    'شكراً لتواصلك',
    'كيف أقدر أساعدك',
    'كيف نقدر نساعدك',
    'نفهم موقفك',
    'لا تزال قائمة',
  ])
}

function asksSameProof(reply: string) {
  return hasAny(reply, ['أرسل إثبات', 'ارسل اثبات', 'أرسل ما يثبت', 'ارسل ما يثبت', 'مستند', 'دليل'])
}

function asksSameClarification(reply: string) {
  return hasAny(reply, ['وش الجزء', 'شنو الجزء', 'حدد', 'وين الغلط', 'ايش الغلط', 'إيش الغلط'])
}

function clean(reply: string, customerName?: string) {
  let r = String(reply ?? '')
  if (customerName) {
    const names = customerName.split(' ')
    const firstName = names[0]
    if (firstName) {
       const re = new RegExp(`(هلا|مرحبا|يا|أهلين)\\s*${firstName}[،,\\s]*`, 'g')
       r = r.replace(re, '')
    }
  }
  return r
    .replace(/عزيزي العميل[،,\s]*/g, '')
    .replace(/عميلنا العزيز[،,\s]*/g, '')
    .replace(/أخوي[،,\s]*/g, '')
    .replace(/كيف أقدر أساعدك[؟?]*/g, '')
    .replace(/كيف نقدر نساعدك[؟?]*/g, '')
    .replace(/شكراً لتواصلك[،,\s]*/g, '')
    .replace(/نفهم موقفك/g, 'واضح كلامك')
    .replace(/لا تزال قائمة/g, 'لسه ظاهرة عندنا')
    .replace(/سيتم/g, 'بنتم')
    .replace(/سوف يتم/g, 'بنتم')
    .replace(/يرجى/g, '')
    .replace(/نفيدكم/g, '')
    .replace(/نود/g, '')
    .trim()
}

function finalGuard(args: {
  current: string
  history: HistoryItem[]
  reply: string
  debtContext: any
  customerName?: string
}) {
  const reply = clean(args.reply, args.customerName)
  const repeated = repeatedMeaning(args.current, args.history)

  if (!reply) return ''
  if (robotic(reply)) return ''

  if ((refusesToPay(args.current) || courtEscalation(args.current) || repeated.repeatedRefusal)) {
    return 'واضح إنك رافض السداد حالياً. بنسجل موقفك على الملف ونحوّله للمراجعة بدل ما نكرر نفس الرد عليك.'
  }

  if (asksDebtDetails(args.current)) {
    const alreadyExplainedDebt = outboundTexts(args.history).some(t =>
      t.includes('المبلغ الظاهر') ||
      t.includes('المرجع') ||
      t.includes('الجهة') ||
      t.includes('نوعها')
    )

    if (alreadyExplainedDebt) {
      return 'سبق وضحت لك البيانات الظاهرة عندنا. إذا الاعتراض على أصل المطالبة بنرفعها للمراجعة بدل ما نكرر نفس الكلام.'
    }

    return debtAnswer(args.debtContext)
  }

  if ((saysNoProof(args.current) || repeated.repeatedNoProof) && (askedProofBefore(args.history) || asksSameProof(reply))) {
    return 'طيب واضح إن ما عندك إثبات حالياً، بنسجل الملاحظة ونرفع الملف للمراجعة بدل ما نكرر نفس الطلب.'
  }

  if ((disputes(args.current) || repeated.repeatedDispute) && (askedClarificationBefore(args.history) || asksSameClarification(reply))) {
    return 'وصلت ملاحظتك إن الاعتراض على المطالبة نفسها، بنرفعها للمراجعة ونوضح لك نتيجة الملف.'
  }

  const oldReplies = outboundTexts(args.history).slice(-8).map(t => t.replace(/\s+/g, ' ').trim())
  const current = reply.replace(/\s+/g, ' ').trim()
  if (oldReplies.some(old => old && (old.includes(current.slice(0, 40)) || current.includes(old.slice(0, 40))))) {
    return ''
  }

  return reply
}

export async function generateWhatsappAutoReply(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  message: string
  conversation_history?: HistoryItem[]
}) {
  const text = args.message.trim()
  const history = args.conversation_history ?? []

  if (!text) return { reply: '', nextAction: 'silent' }
  if (isCloseOnly(text)) return { reply: '', nextAction: 'silent' }
  if (isGreetingOnly(text)) {
    return { reply: text.toLowerCase() === 'hi' || text.toLowerCase() === 'hello' ? 'Hello' : 'وعليكم السلام', nextAction: 'reply' }
  }

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const customerName = debtContext?.customer?.full_name ?? ''

  const hardReply = finalGuard({
    current: text,
    history,
    reply: asksDebtDetails(text) ? debtAnswer(debtContext) : '',
    debtContext,
    customerName,
  })

  if (hardReply) return { reply: hardReply, nextAction: 'reply' }

  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
    return { reply: 'وصلت ملاحظتك، بنراجع الملف ونرد عليك.', nextAction: 'review' }
  }

  const client = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined
  })

  const ai = await client.chat.completions.create({
    model: process.env.OPENROUTER_API_KEY ? 'google/gemini-3.1-pro-preview' : 'gpt-4o',
    temperature: 0.45,
    max_tokens: 420,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `أنت "خالد"، محصل ديون سعودي محترف تعمل في شركة مصدر الرؤية لتحصيل الديون، تبلغ من العمر 45 عاماً، ولديك خبرة 20 عاماً في المملكة العربية السعودية. نبرتك مهذبة ومحترمة وحازمة وجادة. تتواصل حصرياً باللهجة السعودية البيضاء الطبيعية المستخدمة في الواتساب. لا تقوم أبداً بالتهديد أو استخدام لغة وقحة.

=== 🚨 الممنوعات القطعية 🚨 ===

1. العبارات والنبرة المحظورة:
- يمنع منعاً باتاً التصرف كروبوت نصوص (Scenario bot) أو استخدام ردود معلبة.
- يمنع منعاً باتاً استخدام عبارات خدمة العملاء مثل: 'عزيزي العميل'، 'كيف أستطيع مساعدتك'، 'نحن هنا لخدمتك'، 'نشكرك على التواصل'، 'سعداء بخدمتك'، 'أنا هنا لخدمتك'، 'إذا في أي شي ممكن نساعدك فيه، أنا هنا'، 'إذا تحتاج مساعدة إضافية، أنا هنا'.
- يمنع منعاً باتاً الإفراط في استخدام كلمة 'يا غالي' (لا تكررها).
- يمنع استخدام اللغة العربية الفصحى. يمنع استخدام النبرة الروبوتية الآلية.

2. قواعد المحادثة وسير الحوار:
- يمنع منعاً باتاً الرد قبل قراءة وفهم تاريخ المحادثة بالكامل وملف العميل.
- يمنع منعاً باتاً بدء المحادثة من الصفر إذا كان هناك تاريخ سابق للتواصل.
- يمنع منعاً باتاً تكرار نفس السؤال، أو نفس الرد، أو نفس الطلب بصيغة مختلفة.
- يمنع منعاً باتاً طرح أكثر من سؤال واحد في الرسالة الواحدة.
- يمنع منعاً باتاً تجاهل رد العميل السابق، أو سؤاله الأخير، أو ما تم الاتفاق عليه مسبقاً.
- يمنع منعاً باتاً إطالة الرسالة بدون داعٍ.
- يمنع منعاً باتاً تكرار مبلغ الدين، أو اسم الشركة، أو الرقم المرجعي في كل رسالة (اذكرهم فقط عند الضرورة).
- يمنع منعاً باتاً الرد إذا انتهت المحادثة، أو إذا أغلق العميل الموضوع، أو إذا لم يكن هناك داعٍ للرد (قم بإرجاع shouldReply: false).
- يمنع منعاً باتاً تكرار اسم العميل أثناء المحادثة. استخدمه فقط في أول رسالة ترحيبية.

3. قواعد التحصيل والتفاوض:
- يمنع منعاً باتاً عرض التقسيط من تلقاء نفسك.
- يمنع منعاً باتاً الموافقة على طلب التقسيط أو رفضه. يجب عليك فقط تسجيل الطلب ورفعه للمراجعة (nextAction: review_installments) والرد حصراً بـ: "سيتم مراجعة طلبك بخصوص الاقساط وبنعلمك اذا تم الموافقه"
- يمنع منعاً باتاً طلب إثبات، أو مستندات، أو توضيحات أكثر من مرة.
- يمنع منعاً باتاً توجيه أسئلة مثل 'وش الاعتراض؟'، 'وضح الاعتراض؟'، أو 'ايش المشكلة؟' إذا كان العميل قد أجاب عليها مسبقاً.
- يمنع منعاً باتاً تجاهل الاعتراضات، أو ادعاءات السداد، أو الأرقام الخاطئة، أو ادعاءات 'ليس أنا'.
- يمنع منعاً باتاً ذكر نوع المنتج (مثل 'حق الرجوع') للعميل تحت أي ظرف. أشر فقط إلى رقم المطالبة (reference_number).

4. قواعد البيانات والنظام والذاكرة:
- أنت لست مجرد روبوت محادثة. يجب عليك تشغيل تحديثات النظام (Function Calls/AI Actions) لأي حدث مهم ليؤثر على الجدول الزمني (Timeline)، الذاكرة، التقييم (Score)، ولوحة التحكم (Dashboard) (مثل: التنبيهات، الموافقات، الوعود بالسداد، تحديثات الدين).
- يمنع منعاً باتاً اتخاذ قرار وترك النظام بدون تحديث.
- يمنع منعاً باتاً فقدان أو حذف أو تجاهل أي بيانات (تفاصيل العميل، تفاصيل الدين، المدفوعات، الملاحظات، المتابعات، الوعود، الاعتراضات، المرفقات، السجل التاريخي).
- يمنع منعاً باتاً نسيان ما قاله العميل سابقاً. استخدم دائماً 'عقل العميل' (Customer Brain) و 'ذاكرة الذكاء الاصطناعي' (AI Memory).
- يمنع منعاً باتاً تكرار استراتيجية نفسية فشلت مسبقاً. إذا فشلت الاستراتيجية، قم بتغييرها بمرونة واحترافية.

5. قواعد التقييم والنوايا:
- يمنع منعاً باتاً تخمين نية العميل.
- يمنع منعاً باتاً اعتبار كلمة واحدة معزولة كدليل، أو اتخاذ قرار بناءً على كلمة واحدة.
- يمنع منعاً باتاً تجاهل صيغ النفي.

=== ⚙️ التوجيهات التشغيلية ===
- وضح دائماً مصدر الدين باستخدام اسم المحفظة (portfolio_name) فقط إذا كان هذا هو التواصل الأول أو إذا سأل العميل عن ذلك.
- اقرأ تفاصيل الدين، والجدولة، والسبب من حقل debt.notes واشرحها للعميل بوضوح فقط إذا طلب ذلك.
- إذا كان هناك سبب تأمين خارجي (external_insurance_reason)، فاشرح السبب بالتفصيل، وتاريخ الحادث، ونسبة الخطأ، ونوع السيارة مباشرة من ذلك الكائن فقط إذا سأل العميل.
- إذا سأل العميل عن تفاصيل الدين، أجب من سياق الملف أولاً. إذا كانت البيانات مفقودة، قم برفع الأمر للمراجعة البشرية بدلاً من التخمين.
- استخدم تقنيات الإقناع النفسي الذكية لإقناع العميل بالسداد دون أن تكون عدائياً.

Return JSON only:
{
  "shouldReply": true,
  "reply": "short natural WhatsApp reply",
  "nextAction": "reply|silent|explain_debt|review|record_dispute|record_promise|request_receipt|review_installments",
  "confidence": 0.9
}`.trim(),
      },
      {
        role: 'user',
        content: JSON.stringify({
          latestCustomerMessage: text,
          lastAgentMessage: lastOutbound(history),
          conversationHistory: history,
          customerDebtContext: {
             ...debtContext,
             external_insurance_reason: insuranceReasons[debtContext?.summary?.reference_number] || insuranceReasons[debtContext?.summary?.account_number] || null
          },
        }, null, 2),
      },
    ],
  })

  let decision: Decision
  
  const rawContent = ai.choices[0]?.message?.content ?? '{}'
  try {
    let cleanRaw = rawContent.trim()
    if (cleanRaw.startsWith('```json')) {
      cleanRaw = cleanRaw.substring(7)
    } else if (cleanRaw.startsWith('```')) {
      cleanRaw = cleanRaw.substring(3)
    }
    if (cleanRaw.endsWith('```')) {
      cleanRaw = cleanRaw.slice(0, -3)
    }
    decision = JSON.parse(cleanRaw.trim()) as Decision
    console.log('[AI Decision Output]:', decision)
  } catch (err) {
    console.error('[AI Decision Error]: failed to parse JSON', err)
    console.error('[AI Raw Content]:', rawContent)
    decision = {
      shouldReply: true,
      reply: 'وصلت ملاحظتك، بنراجع الملف ونرد عليك.',
      nextAction: 'review',
      confidence: 0.3,
    }
  }

  if (!decision.shouldReply) return { reply: '', nextAction: 'silent' }

  const finalReply = finalGuard({
    current: text,
    history,
    reply: decision.reply,
    debtContext,
    customerName,
  })

  return { reply: finalReply, nextAction: decision.nextAction }
}




export type WhatsappSystemImpact = {
  timeline: boolean
  memory: boolean
  promise: boolean
  alert: boolean
  approval: boolean
  score: boolean
  ai_action: boolean
  dashboard: boolean
  debt_update: boolean
  customer_update: boolean
  risk_impact: 'decrease' | 'neutral' | 'increase' | 'critical'
  summary: string
}

export type WhatsappOperationalDecision = {
  shouldReply: boolean
  reply: string
  nextAction: string
  confidence: number
  systemImpact: WhatsappSystemImpact
}

export async function generateWhatsappOperationalDecision(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  message: string
  conversation_history?: HistoryItem[]
}): Promise<WhatsappOperationalDecision> {
  const aiResult = await generateWhatsappAutoReply(args)
  const reply = aiResult.reply
  const aiAction = aiResult.nextAction
  const text = args.message.trim().toLowerCase()

  const isPromise =
    text.includes('بسدد') || text.includes('بسدده') || text.includes('اسدد') ||
    text.includes('بكرة') || text.includes('بكره') ||
    text.includes('نهاية الشهر') || text.includes('اخر الشهر') || text.includes('آخر الشهر')

  const isRefusal =
    text.includes('ما بسدد') || text.includes('ما راح اسدد') ||
    text.includes('ماني مسدد') || text.includes('ارفض') || text.includes('رفض')

  const isDispute =
    text.includes('ما يخصني') || text.includes('مو صحيح') || text.includes('غير صحيح') ||
    text.includes('غلط') || text.includes('اعتراض') || text.includes('رقم غلط')

  const isPaid =
    text.includes('دفعت') || text.includes('سددت') || text.includes('حولت') ||
    text.includes('حوالة') || text.includes('ايصال') || text.includes('إيصال')

  let nextAction = 'reply'
  let risk_impact: WhatsappSystemImpact['risk_impact'] = 'neutral'
  let summary = 'Inbound WhatsApp message requires system-wide update.'

  const systemImpact: WhatsappSystemImpact = {
    timeline: true,
    memory: true,
    promise: false,
    alert: false,
    approval: false,
    score: true,
    ai_action: true,
    dashboard: true,
    debt_update: false,
    customer_update: false,
    risk_impact,
    summary,
  }

  if (isRefusal) {
    nextAction = 'human_review'
    systemImpact.alert = true
    systemImpact.debt_update = true
    systemImpact.risk_impact = 'increase'
    systemImpact.summary = 'Customer refused payment; debt risk should increase.'
  }

  else if (isPromise) {
    nextAction = 'record_promise'
    systemImpact.promise = true
    systemImpact.risk_impact = 'decrease'
    systemImpact.summary = 'Customer gave a payment promise.'
  }

  if (aiAction === 'review_installments') {
    nextAction = 'record_installment_request'
    systemImpact.approval = true
    systemImpact.alert = true
    systemImpact.summary = 'Customer explicitly requested and insisted on installments. Waiting for management approval.'
  }

  if (isDispute) {
    nextAction = 'record_dispute'
    systemImpact.alert = true
    systemImpact.approval = true
    systemImpact.debt_update = true
    systemImpact.risk_impact = 'critical'
    systemImpact.summary = 'Customer disputed the debt or identity; review required.'
  }

  if (isPaid) {
    nextAction = 'request_receipt'
    systemImpact.approval = true
    systemImpact.memory = true
    systemImpact.timeline = true
    systemImpact.dashboard = true
    systemImpact.summary = 'Customer claimed payment; receipt/review required.'
  }

  return {
    shouldReply: Boolean(reply),
    reply,
    nextAction,
    confidence: 0.9,
    systemImpact,
  }
}

export async function generateProactiveReminder(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  promise_details: any
}): Promise<string> {
  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id,
  })

  const ai = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined
  })

  const res = await ai.chat.completions.create({
    model: process.env.OPENROUTER_API_KEY ? 'google/gemini-2.5-pro' : 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are "أبو فهد" (Abu Fahad), a 45-year-old professional and respectful Saudi debt collector.
Your task is to send a proactive, friendly reminder to the customer about their promise to pay today.
DO NOT BE AGGRESSIVE. Be very polite, using appropriate Saudi greetings.
The promise details are: ${JSON.stringify(args.promise_details)}.
Mention the promised amount and ask if they have managed to transfer the amount today.
KEEP IT VERY SHORT AND NATURAL. (1-2 sentences).
NEVER mention the internal promise ID.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          customerDebtContext: debtContext
        }, null, 2)
      }
    ]
  })

  return res.choices[0]?.message?.content ?? 'السلام عليكم، للتذكير بموعد السداد المتفق عليه اليوم، طمنا إذا تم الإيداع.'
}
