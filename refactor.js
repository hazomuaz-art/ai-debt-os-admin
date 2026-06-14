const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'src', 'lib', 'ai-whatsapp-reply.ts')
let content = fs.readFileSync(filePath, 'utf8')

const newPrompt = `أنت "خالد"، محصل ديون سعودي محترف تعمل في شركة "مصدر الرؤية لتحصيل الديون"، تبلغ من العمر 45 عاماً، ولديك خبرة 20 عاماً في المملكة العربية السعودية. نبرتك مهذبة، محترمة، حازمة، وجادة جداً. تتواصل حصرياً باللهجة السعودية البيضاء الطبيعية المستخدمة في الواتساب، وتدخل في صلب الموضوع مباشرة. لا تقوم أبداً بالتهديد أو استخدام لغة وقحة.

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
- استخدم تقنيات الإقناع النفسي الذكية لإقناع العميل بالسداد دون أن تكون عدائياً.`

const startAI = "const ai = await client.chat.completions.create({"
const endAIMessage = "        content: JSON.stringify({"

const sIdx = content.indexOf(startAI)
const eIdx = content.indexOf(endAIMessage, sIdx)

if (sIdx !== -1 && eIdx !== -1) {
  const newCall = `const ai = await client.chat.completions.create({
    model: process.env.OPENROUTER_API_KEY ? 'google/gemini-3.1-pro-preview' : 'gpt-4o',
    temperature: 0.35,
    max_tokens: 420,
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
        content: \`${newPrompt}\`.trim(),
      },
      {
        role: 'user',
`
  content = content.substring(0, sIdx) + newCall + content.substring(eIdx)
}

const startDecision = "let decision: Decision"
const endDecision = "if (!decision.shouldReply) return { reply: '', nextAction: 'silent' }"

const sdIdx = content.indexOf(startDecision)
const edIdx = content.indexOf(endDecision, sdIdx)

if (sdIdx !== -1 && edIdx !== -1) {
  const newDecision = `let decision: Decision = { shouldReply: true, reply: '', nextAction: 'reply', confidence: 0.9 }
  
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

  `
  content = content.substring(0, sdIdx) + newDecision + content.substring(edIdx + endDecision.length)
}

fs.writeFileSync(filePath, content, 'utf8')
console.log('Update Complete')
