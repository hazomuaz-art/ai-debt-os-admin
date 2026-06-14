import OpenAI from 'openai'
import { buildCustomerDebtContext } from '@/lib/customer-debt-context'
import { buildCustomerBrain } from '@/lib/customer-brain'

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
    | 'record_installment_request'
    | 'record_promise'
    | 'record_dispute'
    | 'human_review'
  reason: string
  message: string
}

type HistoryItem = {
  direction: string
  content: string
}

function norm(text: string) {
  return String(text ?? '').trim().toLowerCase()
}

function hasAny(text: string, words: string[]) {
  const v = norm(text)
  return words.some(w => v.includes(w.toLowerCase()))
}

function isCloser(text: string) {
  return /^(تمام|تم|اوكي|أوكي|ok|okay|خلاص|ماشي|طيب|يعطيك العافية|شكرا|شكراً|thanks|thank you)$/i.test(text.trim())
}

function isGreeting(text: string) {
  const normalized = text.trim().toLowerCase()
  const greetingRegex = /^(السلام|سلام|هلا|مرحبا|هاي|hi|hello|مساء|صباح|يسعد|يا هلا|أهلين|اهلين|كيف|شلونك|اخبارك|كيفك).*/i
  const businessRegex = /(سدد|رقم|مبلغ|ريال|فاتورة|اقساط|قسط|راتب|تحويل|خصم|بنك|رسالة|شركة|مديونية|دين|حساب|أدفع|ادفع|فلوس|صعب|ظروف)/i
  return greetingRegex.test(normalized) && normalized.length <= 40 && !businessRegex.test(normalized)
}

function cleanReply(reply: string) {
  return String(reply ?? '')
    .replace(/أخوي[،,\s]*/g, '')
    .replace(/عزيزي العميل[،,\s]*/g, '')
    .replace(/عميلنا العزيز[،,\s]*/g, '')
    .trim()
}

function detectSignals(text: string) {
  return {
    paymentClaim: hasAny(text, ['سددت', 'دفعت', 'حولت', 'ايصال', 'إيصال', 'paid', 'receipt', 'transfer']),
    dispute: hasAny(text, ['غلط', 'اعتراض', 'مو صحيح', 'ما اعرف', 'ما أعرف', 'not mine', 'wrong amount']),
    installment: hasAny(text, ['تقسيط', 'اقساط', 'أقساط', 'installment', 'installments']),
    promise: hasAny(text, ['بسدد', 'اسدد', 'بسددها', 'نهاية الشهر', 'بكرة', 'بكره', 'الخميس', 'الراتب', 'salary', 'tomorrow']),
    hardship: hasAny(text, ['ما عندي', 'ظروف', 'فلوس', 'راتب', 'متعسر', 'ما اقدر', 'ما أقدر']),
    angry: hasAny(text, ['ازعاج', 'ازعجتونا', 'شكوى', 'محامي', 'بلاغ', 'court', 'lawyer', 'complaint']),
    wrongNumber: hasAny(text, ['الرقم غلط', 'ما يخصني', 'مو رقمي', 'wrong number']),
  }
}

function lastOutbound(history: HistoryItem[]) {
  return [...history].reverse().find(m => m.direction === 'outbound')?.content ?? ''
}

function previousOutboundTexts(history: HistoryItem[]) {
  return history.filter(m => m.direction === 'outbound').slice(-5).map(m => String(m.content ?? ''))
}

function isRobotic(reply: string) {
  return hasAny(reply, [
    'أنا هنا للمساعدة',
    'كيف أقدر أساعدك',
    'كيف أقدر أخدمك',
    'إذا عندك أي استفسار',
    'شكراً لتواصلك',
    'عميلنا العزيز',
    'عزيزي العميل',
    'يرجى التكرم',
    'نود إشعاركم',
    'نفيدكم',
    'خطة سداد',
    'نرتب لك',
    'نقدر نرتب',
  ])
}

function isRepeated(reply: string, history: HistoryItem[]) {
  const r = reply.replace(/\s+/g, ' ').trim()
  if (!r) return false
  return previousOutboundTexts(history).some(p => {
    const old = p.replace(/\s+/g, ' ').trim()
    return old && (old.includes(r.slice(0, 35)) || r.includes(old.slice(0, 35)))
  })
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
  const lastAgentMessage = lastOutbound(history)
  const signals = detectSignals(text)

  if (isCloser(text)) {
    return { shouldReply: false, action: 'close_conversation', reason: 'customer_closed_chat', message: '' }
  }

  if (isGreeting(text)) {
    let msg = 'يا هلا بك، تفضل؟'
    if (text.includes('سلام')) msg = 'وعليكم السلام، حياك الله تفضل؟'
    else if (text.includes('مساء')) msg = 'مساء النور، تفضل؟'
    else if (text.includes('صباح')) msg = 'صباح النور، تفضل؟'
    
    // If it is the very first message ever, we might want a simple "وعليكم السلام"
    if (history.length <= 2 && text.includes('سلام')) {
      msg = 'وعليكم السلام'
    }

    return { shouldReply: true, action: 'reply', reason: 'greeting', message: msg }
  }

  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const customerBrain = buildCustomerBrain(debtContext)

  if (!process.env.OPENROUTER_API_KEY && !process.env.OPENAI_API_KEY) {
    return { shouldReply: true, action: 'reply', reason: 'fallback_no_api_key', message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.' }
  }

  const client = new OpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined
  })

  // Format history to proper OpenAI message roles
  const messageHistory = history.map(m => ({
    role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: String(m.content)
  }))

  // Determine Intent (Router Logic)
  type AgentIntent = 'INTRODUCTION' | 'NEGOTIATION' | 'DISPUTE' | 'GENERAL'
  let intent: AgentIntent = 'GENERAL'
  
  const historyText = history.map(h => String(h.content)).join(' ')
  const balance = debtContext.debt?.current_balance ? String(debtContext.debt.current_balance) : null
  const creditor = debtContext.debt?.creditor_name ? String(debtContext.debt.creditor_name) : null
  
  const hasMentionedDebt = (balance && historyText.includes(balance)) || (creditor && historyText.includes(creditor))
  
  if (!hasMentionedDebt && history.length <= 4 && !signals.angry && !signals.dispute) {
    intent = 'INTRODUCTION'
  } else if (signals.angry || signals.dispute || signals.wrongNumber) {
    intent = 'DISPUTE'
  } else if (signals.promise || signals.installment || signals.hardship) {
    intent = 'NEGOTIATION'
  }

  // Specialized Prompts
  let specializedPrompt = ''

  if (intent === 'INTRODUCTION') {
    specializedPrompt = `
=== وكيل التقديم (Introduction Agent) ===
الهدف: أنت تتحدث مع العميل لأول مرة (بعد التحية).
المهمة:
- اذكر بوضوح أنك من طرف الشركة الدائنة (creditor_name) بخصوص مديونية قدرها (current_balance).
- اسأل العميل مباشرة وبكل لباقة عن الموعد الذي يقدر فيه سداد هذا المبلغ.
- اذكر المبلغ واسم الشركة مرة واحدة فقط في رسالتك، ولا تسأل أكثر من سؤال واحد.
`
  } else if (intent === 'DISPUTE') {
    specializedPrompt = `
=== وكيل معالجة الاعتراضات (Dispute & De-escalation Agent) ===
الهدف: العميل إما غاضب، أو ينكر المديونية، أو يقول أن الرقم خطأ.
المهمة:
- إذا كان العميل غاضباً، امتص غضبه بكلمة واحدة (مثل: أقدر انزعاجك، أو حقك تزعل) ثم اطلب منه الهدوء لنراجع الملف.
- إذا أنكر المديونية أو قال الرقم خطأ، اطلب منه الإثبات أو قل له أنك سترفع ملاحظته للإدارة للمراجعة.
- 🔴 تحذير هام: يمنع منعاً باتاً تكرار ذكر مبلغ المديونية الآن. مهمتك فقط معالجة الاعتراض أو امتصاص الغضب بهدوء.
`
  } else if (intent === 'NEGOTIATION') {
    specializedPrompt = `
=== وكيل التفاوض والوعود (Negotiation & Promise Agent) ===
الهدف: العميل يقدم أعذاراً، أو يطلب أقساطاً، أو يعد بالسداد لاحقاً.
المهمة:
- إذا أعطى عذراً (مثل: ظروفي صعبة)، تعاطف معه بكلمة واحدة (الله يعينك، مقدر ظرفك) ثم فاوضه على موعد للسداد الجزئي أو الكلي.
- إذا طلب تقسيط ولم يكن لديه تقسيط معتمد في النظام: أخبره أن الأقساط تحتاج موافقة وسنرفع طلباً، ولا توافق من نفسك أبداً.
- إذا وعد بالسداد لكن بدون تاريخ، اسأله عن التاريخ الدقيق للسداد.
- 🔴 تحذير هام: لا تكرر إجمالي المبلغ في كل رسالة، العميل يعرفه مسبقاً. ركز فقط على التفاوض وموعد السداد.
`
  } else {
    specializedPrompt = `
=== الوكيل العام (General Collection Agent) ===
الهدف: متابعة المحادثة بشكل عام.
المهمة:
- رد بشكل طبيعي وحازم بناءً على كلام العميل الأخير.
- إذا كان قد ذكر أنه سدد، اطلب منه إرسال الإيصال.
- 🔴 تحذير هام: يُمنع منعاً باتاً تكرار ذكر إجمالي المبلغ أو اسم الشركة في ردك الحالي، لأن العميل يعرفه مسبقاً. اكتفِ بسؤاله عن الخطوة القادمة.
`
  }

  // Check active states and override if necessary
  const activeInstallmentApproval = debtContext.recent_approvals?.find(a => a.approval_type === 'installment' && a.status === 'approved')
  const activePromise = debtContext.recent_promises?.find(p => p.status === 'pending')

  if (activeInstallmentApproval) {
    specializedPrompt += `
- 🔴 حالة خاصة جداً: العميل لديه خطة تقسيط معتمدة بالفعل! لا ترفض التقسيط، بل أكد له الأقساط واطلب منه سداد الدفعة الأولى أو القسط القادم.
`
  }
  if (activePromise) {
    specializedPrompt += `
- 🔴 حالة خاصة جداً: العميل لديه وعد سداد مسجل بمبلغ ${activePromise.promised_amount} في تاريخ ${activePromise.promised_date}. ذكّره بهذا الوعد وألزمه به.
`
  }

  const systemRulesText = customerBrain.strict_rules ? customerBrain.strict_rules.join('\n') : ''

  const ai = await client.chat.completions.create({
    model: 'anthropic/claude-3.5-sonnet',
    temperature: 0.28,
    max_tokens: 260,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `
أنت "خالد"، محصّل ديون سعودي عمرك 45 سنة.
تتحدث بلهجة سعودية بيضاء، طبيعية جداً، وكأنك تتحدث في الواتساب مع شخص حقيقي.

=== القواعد الأساسية للبيانات (STRICT RULES) ===
${systemRulesText}

${specializedPrompt}

=== تعليمات عامة للمحادثة ===
1. تصرف كإنسان طبيعي تماماً (لا تقل "عزيزي العميل" أو "كيف أقدر أخدمك").
2. يُمنع منعاً باتاً تكرار سؤال سألته سابقاً، أو إعادة المطالبة بشيء وافق عليه العميل للتو.
3. ردودك يجب أن تكون قصيرة جداً (جملة أو جملتين كحد أقصى).
4. إذا انتهت المحادثة (العميل أنهى النقاش أو ودّعك)، ابق صامتاً (اختر silent).


Return JSON only:
{
  "shouldReply": true,
  "action": "reply|silent|request_proof|request_clarification|negotiate|pressure|close_conversation|record_installment_request|record_promise|record_dispute|human_review",
  "reason": "short reason",
  "message": "WhatsApp reply or empty"
}
        `.trim(),
      },
      ...messageHistory,
      {
        role: 'user',
        content: `
Current customer message:
${text}

Important Context:
- Detected signals: ${JSON.stringify(signals)}
- Last agent message: ${lastAgentMessage}
- Customer & Debt Summary: ${JSON.stringify(customerBrain.summary)}
- Negotiation Strategy: ${JSON.stringify(customerBrain.negotiation_profile)}

If the last agent message was a question and the customer just answered it, do not ask the same question again. Move the conversation forward naturally.
        `.trim(),
      },
    ],
  })

  let parsed: CollectorDecision

  try {
    parsed = JSON.parse(ai.choices[0]?.message?.content ?? '{}')
  } catch {
    parsed = { shouldReply: true, action: 'reply', reason: 'invalid_json', message: 'وصلت ملاحظتك، بنراجعها على الملف ونمشي بالإجراء المناسب.' }
  }

  parsed.message = cleanReply(parsed.message)

  if (!parsed.shouldReply || !parsed.message.trim()) {
    return { ...parsed, shouldReply: false, message: '' }
  }

  if (isRobotic(parsed.message) || isRepeated(parsed.message, history)) {
    parsed.message = 'وصلت النقطة، بنثبتها على الملف ونمشي بالإجراء المناسب بدل تكرار نفس الكلام.'
    parsed.action = parsed.action === 'silent' ? 'reply' : parsed.action
    parsed.reason = 'anti_repetition_guard'
  }

  return parsed
}