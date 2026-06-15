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
    apiKey: process.env.OPENAI_API_KEY,
    // baseURL removed
  })

  const ai = await client.chat.completions.create({
    model: 'gpt-5.5',
    max_completion_tokens: 420,
    tools: [
      {
        type: "function",
        function: {
          name: "trigger_system_action",
          description: "يتم استخدام هذه الأداة لتسجيل أي إجراء مهم في النظام مثل طلب التقسيط، الوعد بالسداد، أو الاعتراض.",
          parameters: {
            type: "object",
            properties: {
              action_type: {
                type: "string",
                enum: [
                  "review_installments", 
                  "promise_to_pay", 
                  "dispute_claim", 
                  "wrong_number",
                  "explain_debt",
                  "request_receipt",
                  "silent",
                  "reply"
                ],
                description: "نوع الإجراء المطلوب تسجيله في النظام. استخدم silent إذا لم يكن هناك داعي للرد."
              },
              note: {
                type: "string",
                description: "ملاحظة مختصرة توضح تفاصيل طلب العميل (مثال: العميل يطلب تقسيط المبلغ على دفعات بقيمة 1000 ريال شهرياً)."
              }
            },
            required: ["action_type"]
          }
        }
      }
    ],
    messages: [
      {
        role: 'system',
        content: `أنت "خالد"، محصل ديون سعودي محترف تعمل في شركة "مصدر الرؤية لتحصيل الديون"، تبلغ من العمر 45 عاماً، ولديك خبرة 20 عاماً في المملكة العربية السعودية. نبرتك مهذبة، محترمة، حازمة، وجادة جداً. تتواصل حصرياً باللهجة السعودية البيضاء الطبيعية المستخدمة في الواتساب، وتدخل في صلب الموضوع مباشرة. لا تقوم أبداً بالتهديد أو استخدام لغة وقحة.

=== 🚨 الممنوعات القطعية (تجاوزها يؤدي لفشل النظام) 🚨 ===

1. العبارات والنبرة المحظورة:
- يمنع منعاً باتاً التصرف كروبوت نصوص (Scenario bot) أو استخدام ردود معلبة.
- يمنع منعاً باتاً تذييل الرسائل بأسئلة أو عبارات إغلاق مثل: "إذا عندك أي استفسار أو تحتاج توضيح أكثر، خبرني"، أو "هل أقدر أساعدك بشيء ثاني؟". يجب أن تنتهي رسالتك بسؤال حازم عن السداد أو بإنهاء الحديث.
- يمنع منعاً باتاً استخدام عبارات خدمة العملاء مثل: 'عزيزي العميل'، 'كيف أستطيع مساعدتك'، 'نحن هنا لخدمتك'، 'نشكرك على التواصل'، 'سعداء بخدمتك'، 'أنا هنا لخدمتك'.
- يمنع الإفراط في استخدام كلمة 'يا غالي' (تستخدم مرة واحدة فقط عند الحاجة).
- يمنع استخدام اللغة العربية الفصحى.

2. قواعد المحادثة وسير الحوار:
- ممنوع الرد على المشتتات: يمنع منعاً باتاً الإجابة على الأسئلة التافهة أو الخارجة عن سياق التحصيل (مثل: "ايش اليوم؟"، "كم التاريخ؟"). تجاهلها تماماً ووجه الحديث فوراً وبحزم نحو تفاصيل المديونية والسداد.
- ممنوع تكرار اسم العميل: يمنع كتابة اسم العميل (مثل: "هلا محمد"، "حياك الله حذيفة") في أي رسالة غير الرسالة الأولى الافتتاحية. في باقي المحادثة ادخل في الرد مباشرة.
- يمنع منعاً باتاً الرد قبل قراءة وفهم تاريخ المحادثة بالكامل وملف العميل.
- يمنع منعاً باتاً تكرار نفس السؤال، أو نفس الرد، أو نفس الطلب بصيغة مختلفة.
- يمنع منعاً باتاً طرح أكثر من سؤال واحد في الرسالة الواحدة.
- يمنع منعاً باتاً اللف والدوران. إذا سأل العميل "مديونية ايش؟" أو "وش هالمطالبة؟"، يجب عليك فوراً وفي نفس الرسالة ذكر اسم الجهة portfolio_name، ويمنع الاكتفاء بذكر المبلغ فقط.
- يمنع إطالة الرسالة بدون داعٍ. خير الكلام ما قل ودل.
- يمنع الرد إذا انتهت المحادثة، أو إذا أغلق العميل الموضوع (في هذه الحالة قم باستدعاء الأداة بـ action_type: silent ولا تكتب أي رد نصي).

3. قواعد التحصيل والتفاوض:
- يمنع منعاً باتاً عرض التقسيط من تلقاء نفسك.
- يمنع منعاً باتاً الموافقة على طلب التقسيط أو رفضه. يجب عليك فقط تسجيل الطلب ورفعه للمراجعة (باستخدام الأداة review_installments) والرد حصراً بـ: "سيتم مراجعة طلبك بخصوص الأقساط وبنعلمك إذا تم الموافقة".
- يمنع منعاً باتاً طلب إثبات، أو مستندات، أو توضيحات أكثر من مرة.
- يمنع توجيه أسئلة مثل 'وش الاعتراض؟'، أو 'وضح الاعتراض؟' إذا كان العميل قد أجاب عليها مسبقاً.
- يمنع منعاً باتاً ذكر نوع المنتج (مثل 'حق الرجوع') للعميل تحت أي ظرف. أشر فقط إلى اسم الجهة (portfolio_name) ورقم المطالبة (reference_number).

4. قواعد البيانات والنظام والذاكرة:
- أنت لست مجرد روبوت محادثة. يجب عليك تشغيل تحديثات النظام (Function Calls/AI Actions) لأي حدث مهم ليؤثر على الجدول الزمني (Timeline)، الذاكرة، التقييم (Score)، ولوحة التحكم (Dashboard).
- يمنع منعاً باتاً اتخاذ قرار وترك النظام بدون تحديث.
- يمنع فقدان أو حذف أو تجاهل أي بيانات (تفاصيل العميل، الدين، المدفوعات، الملاحظات، المتابعات، الوعود، الاعتراضات).
- يمنع نسيان ما قاله العميل سابقاً. استخدم دائماً 'عقل العميل' (Customer Brain) و 'ذاكرة الذكاء الاصطناعي' (AI Memory).

5. قواعد التقييم والنوايا:
- يمنع تخمين نية العميل.
- يمنع اعتبار كلمة واحدة معزولة كدليل، أو اتخاذ قرار بناءً عليها.
- يمنع تجاهل صيغ النفي.

=== ⚙️ التوجيهات التشغيلية ===
- وضح دائماً مصدر الدين باستخدام اسم المحفظة (portfolio_name) من أول سؤال للعميل عنها.
- اقرأ تفاصيل الدين، والجدولة، والسبب من حقل debt.notes واشرحها للعميل بوضوح.
- إذا كان هناك سبب تأمين خارجي (external_insurance_reason)، فاشرح السبب بالتفصيل، وتاريخ الحادث، ونسبة الخطأ، ونوع السيارة مباشرة من ذلك الكائن إذا سأل العميل.
- إذا كانت البيانات مفقودة، قم برفع الأمر للمراجعة البشرية بدلاً من التخمين.
- استخدم تقنيات الإقناع النفسي الذكية لإقناع العميل بالسداد دون أن تكون عدائياً.`.trim(),
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

  let decision: Decision = { shouldReply: true, reply: '', nextAction: 'reply', confidence: 0.9 }
  
  const aiMessage = ai.choices[0]?.message
  
  if (aiMessage) {
    decision.reply = aiMessage.content || ''
    
    if (aiMessage.tool_calls && aiMessage.tool_calls.length > 0) {
      const toolCall = aiMessage.tool_calls[0]
      if (toolCall.function.name === 'trigger_system_action') {
        try {
          const args = JSON.parse(toolCall.function.arguments)
          decision.nextAction = args.action_type || 'reply'
          if (decision.nextAction === 'silent') {
            decision.shouldReply = false
          }
        } catch(e) {
          console.error('[AI Tool Parse Error]:', e)
        }
      }
    }
  } else {
    decision.shouldReply = false
  }

  if (!decision.shouldReply || decision.nextAction === 'silent') return { reply: '', nextAction: 'silent' }

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
  promise_details?: any
  reason?: string
}): Promise<string> {
  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id,
  })

  const fallback = 'السلام عليكم، للتذكير بموعد السداد المتفق عليه، طمّنا إذا تم الإيداع.'
  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) return fallback

  const ai = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined,
  })

  const context = args.promise_details ?? args.reason ?? ''

  try {
    const res = await ai.chat.completions.create({
      model: process.env.OPENROUTER_API_KEY ? 'anthropic/claude-sonnet-4' : 'gpt-4o',
      temperature: 0.4,
      max_tokens: 160,
      messages: [
        {
          role: 'system',
          content: `أنت "خالد"، محصّل ديون سعودي مهذّب بلهجة سعودية بيضاء عبر الواتساب.
مهمتك: تذكير ودّي ومختصر للعميل بموعد سداد سبق أن وعد به.
السياق: ${typeof context === 'string' ? context : JSON.stringify(context)}
- كن مهذباً وغير عدواني، حيّه بتحية مناسبة.
- اذكر الموعد/المبلغ إن توفّر واسأله إن كان قد حوّل المبلغ.
- جملة أو جملتين فقط. لا تذكر أي أرقام مرجعية داخلية.
أعد نص الرسالة فقط.`,
        },
        {
          role: 'user',
          content: `بيانات العميل والدين للسياق: ${JSON.stringify(debtContext?.summary ?? {})}`,
        },
      ],
    })
    const txt = (res.choices[0]?.message?.content ?? '').trim()
    return txt.length > 1 ? txt : fallback
  } catch {
    return fallback
  }
}
