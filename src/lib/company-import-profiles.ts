// ════════════════════════════════════════════════════════════════════════
// Company import profiles — generalized import system for known client
// companies/portfolios.
//
// Each profile carries everything the importer needs to handle one
// company's raw export correctly without per-company custom code:
//   - aliases: every spelling variant seen across source files, so a
//     human picking a file or an automated match can resolve to one
//     canonical company regardless of how the source spelled the name.
//   - category: maps to the `portfolios.category` CHECK constraint.
//   - columnAliases: company-specific column headers (often English/system
//     names like CATEGORY, MNP, SADAD_NUMBER) that the generic column
//     mapper in debts/import/route.ts doesn't recognise — mapped only
//     where there's a confident 1:1 match to a standard debt/customer
//     field. Anything not mapped here AND not caught by the generic
//     mapper is preserved (not dropped) under debts.metadata.extra.
//   - outcomeCategories: the company-specific list of contact-outcome
//     statuses (from "تصنيفات جميع الشركات.xlsx"), seeded onto the
//     portfolio's metadata so the UI can show the right dropdown instead
//     of a generic one.
//
// Source: "تصنيفات جميع الشركات.xlsx" (outcome categories) +
//         "الاعمدة الفعليه + عدد الحسابات.xlsx" (column schema + sector).
// ════════════════════════════════════════════════════════════════════════

export type PortfolioCategory =
  | 'telecom' | 'insurance' | 'utility' | 'recruitment'
  | 'government' | 'finance' | 'agriculture' | 'other'

// Internal debt-status enum — must match the `debts_status_check` CHECK
// constraint in the database exactly.
export type DebtStatus =
  | 'active' | 'in_progress' | 'promised' | 'partial' | 'in_negotiation'
  | 'payment_plan' | 'settled' | 'written_off' | 'legal' | 'disputed'

// What a single company-specific outcome category (e.g. "وعد بالسداد")
// means for the agent and the system. Data only — no logic — so correcting
// any individual category later is a one-line edit, never a code change.
export type OutcomeMeta = {
  status:     DebtStatus | null  // null = this category does not imply a debt-status change
  isTerminal: boolean            // true = stop auto-replies, route to human review (never auto-decided by AI)
  meaning:    string             // short Arabic context line injected into the agent's prompt
  behavior:   string             // short Arabic behavior instruction for the agent's next reply
  // true = this category requires verification the AI has no way to perform
  // (e.g. an external kafeel/exit-re-entry lookup, or a staff-only manual
  // flag like "missing attachments") — excluded from the closed list shown
  // to the classifier entirely, never auto-assigned from chat text. Still
  // stays in outcomeCategories for the manual dropdown a human collector
  // uses (see UpdateDebtStatusSelect.tsx).
  aiExcluded?: boolean
}

export type CompanyImportProfile = {
  key:               string
  nameAr:            string
  nameEn?:           string
  category:          PortfolioCategory
  aliases:           string[]          // lowercased, trimmed
  columnAliases?:    Record<string, string>  // lowercased header -> standard field
  outcomeCategories: string[]
  outcomeMeta:       Record<string, OutcomeMeta>
}

const norm = (s: string) => s.toLowerCase().trim()

// ────────────────────────────────────────────────────────────────────────
// Default classification rules — applied uniformly to every company's
// outcome-category list so corrections stay centralized in one place.
// Order matters: first matching rule wins.
// ────────────────────────────────────────────────────────────────────────
const OUTCOME_RULES: Array<{ test: (label: string) => boolean; meta: Omit<OutcomeMeta, 'meaning' | 'behavior'> & { meaningTpl: string; behaviorTpl: string } }> = [
  {
    test: l => l.includes('وعد بالسداد') || l.includes('بيفيد بالسداد'),
    meta: { status: 'promised', isTerminal: false,
      meaningTpl: 'العميل وعد بالسداد ("${label}").',
      behaviorTpl: 'ثبّت الوعد بتاريخ محدد، وذكّره بلطف قرب الموعد. لا تكرر نفس السؤال إن كان قد أعطى تاريخاً فعلاً.' },
  },
  {
    // NOTE: these categories mean a payment was *actually completed*. They
    // must NEVER be inferred from chat text alone — real payment status
    // changes only ever come from the receipt OCR pipeline
    // (payment-receipt.ts), which has actual evidence. A customer merely
    // saying words like "سداد"/"جزء" in a question or hypothetical is not
    // evidence of payment. status stays null here on purpose so this
    // classifier (driven by free-text LLM matching) can never flip
    // debts.status to settled/partial without a real transaction —
    // isTerminal routes it to human review instead so a person verifies
    // the claim before anything changes.
    test: l => l.includes('سداد كامل') || (l.includes('تم السداد') && !l.includes('جزئ')),
    meta: { status: null, isTerminal: true,
      meaningTpl: 'العميل يدّعي أنه سدد المديونية بالكامل ("${label}") — لم يُستلم إيصال/إثبات فعلي بعد.',
      behaviorTpl: 'اطلب منه صورة الإيصال لتأكيد السداد قبل إغلاق الملف. لا تغيّر حالة الدين بناءً على كلامه فقط.' },
  },
  {
    test: l => l.includes('سداد جزئ') || l.includes('سدد جزء'),
    meta: { status: null, isTerminal: true,
      meaningTpl: 'العميل يدّعي أنه سدد جزءاً من المديونية ("${label}") — لم يُستلم إيصال/إثبات فعلي بعد.',
      behaviorTpl: 'اطلب منه صورة إيصال التحويل لتأكيد المبلغ المسدد فعلاً قبل أي تحديث لحالة الملف. لا تغيّر حالة الدين بناءً على كلامه فقط.' },
  },
  {
    test: l => l.includes('مماطل'),
    meta: { status: 'in_negotiation', isTerminal: false,
      meaningTpl: 'العميل مصنَّف كمماطل سابقاً ("${label}") — وعود متكررة بدون التزام فعلي.',
      behaviorTpl: 'كن أكثر حزماً ومباشرة، واطلب تاريخاً ومبلغاً محددين، لا تقبل وعوداً غامضة جديدة.' },
  },
  {
    test: l => l.includes('معترض') || l.includes('انكر') || l.includes('أنكر') || l.includes('بينات غير صحيحة'),
    meta: { status: 'disputed', isTerminal: false,
      meaningTpl: 'العميل يعترض على المديونية أو ينكر وجودها ("${label}").',
      behaviorTpl: 'لا تطالبه بالسداد مباشرة، اطلب توضيح سبب الاعتراض ووجّهه لقسم المراجعة عند الحاجة.' },
  },
  {
    test: l => l.includes('متوفي') || l.includes('مسجون') || l.includes('مفلس'),
    meta: { status: null, isTerminal: true,
      meaningTpl: 'حالة تحتاج مراجعة بشرية فورية — لا يمكن للذكاء الاصطناعي أن يقرر بشأنها ("${label}").',
      behaviorTpl: 'لا ترسل أي رد تلقائي إضافي بخصوص السداد على هذا الأساس، الملف يحتاج تدخل بشري.' },
  },
  {
    test: l => l.includes('الرقم خطأ') || l.includes('رقم التواصل غير صحيح') || l.includes('الرقم مغلق') || l.includes('لا يوجد بيانات تواصل'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'مشكلة في بيانات التواصل، ليست تغيّراً في حالة الدين ("${label}").',
      behaviorTpl: 'لا علاقة لهذا بمنطق السداد، يحتاج فقط تحديث بيانات الاتصال من الإدارة.' },
  },
  {
    test: l => l.includes('طلب أقساط') || l.includes('طلب اقساط') || l.includes('طلب مهلة') || l.includes('مهلة للسداد') || l.includes('طلب تسوية') || l.includes('تفاوض'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل طلب تقسيطاً أو تسوية أو مهلة ("${label}") — يحتاج موافقة إدارة.',
      behaviorTpl: 'أفهمه أن طلبه رُفع للمراجعة، لا توافق على أي تقسيط أو تسوية من عندك مباشرة.' },
  },
  // ─────────────────────────────────────────────────────────────────────
  // Real gap found during a deep audit (2026-07-02), fixed with explicit
  // sign-off from the account owner on every category's real meaning and
  // AI-usability below — over half of every large portfolio's categories
  // (Saudi Energy 17/30, National Water 10/19, insurance 10/18) previously
  // fell through to the generic "حالة عامة محدَّثة على الملف" fallback with
  // zero differentiation between them. Order matters: MORE SPECIFIC rules
  // must come before more generic ones that would otherwise shadow them
  // (e.g. "قريب/صديق" contact before the generic "تم التواصل مع" pattern).
  // ─────────────────────────────────────────────────────────────────────
  {
    // AI-EXCLUDED: confirmed by the account owner — determined via an
    // external kafeel/exit-re-entry lookup the AI has no access to, not
    // from anything the customer says in chat. Same reasoning applied to
    // every portfolio using this exact label (all telecom/utility).
    test: l => l.includes('خروج نهائى') || l.includes('خروج نهائي'),
    meta: { status: null, isTerminal: false, aiExcluded: true,
      meaningTpl: 'العميل خرج نهائياً من السعودية (يُحدَّد عبر منصة استعلام كفيل/موظف وافد خارجياً، وليس من كلام العميل) ("${label}").',
      behaviorTpl: 'لا يُستخدم هذا التصنيف من قِبل الذكاء الاصطناعي إطلاقاً — يدوي فقط بعد تحقق إداري خارجي.' },
  },
  {
    // AI-EXCLUDED: confirmed by the account owner — set by the human
    // collector when required attachments/documents are missing on the
    // insurer's own side, never inferred from the customer's words.
    test: l => l.includes('نواقص مستندات'),
    meta: { status: null, isTerminal: false, aiExcluded: true,
      meaningTpl: 'نقص في مستندات مطلوبة لاستكمال الملف — يحدده المحصّل يدوياً ("${label}").',
      behaviorTpl: 'لا يُستخدم هذا التصنيف من قِبل الذكاء الاصطناعي إطلاقاً — يدوي فقط.' },
  },
  {
    // AI-EXCLUDED: structurally impossible to trigger from a customer
    // message — classification only ever runs when an inbound message
    // exists, so "no response at all" can never itself be the input. Left
    // for manual/future time-based use, not the conversational classifier.
    test: l => l.includes('لم يتم الرد') || l.includes('لم يتم التواصل'),
    meta: { status: null, isTerminal: false, aiExcluded: true,
      meaningTpl: 'تم إرسال عدة رسائل أو محاولات اتصال للعميل بدون أي رد منه ("${label}").',
      behaviorTpl: 'لا يُستخدم هذا التصنيف من قِبل الذكاء الاصطناعي إطلاقاً — لا يمكن تقنياً استنتاجه من رسالة واردة (لا توجد رسالة أصلاً في هذه الحالة).' },
  },
  {
    test: l => l.includes('قريب او صديق') || l.includes('قريب أو صديق'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'الرد الفعلي وصل من قريب أو صديق للعميل، وليس من العميل نفسه ("${label}").',
      behaviorTpl: 'اطلب رقم تواصل مباشر مع العميل نفسه إن أمكن، ولا تفترض أن الشخص المتحدث هو العميل صاحب الدين.' },
  },
  {
    test: l => l.includes('مرفوعه قانونيا') || l.includes('مرفوعة قانونيا') || l.includes('مرفوعة قانونياً'),
    meta: { status: null, isTerminal: true,
      meaningTpl: 'العميل صرّح بوجود إجراء قانوني مرفوع فعلياً من الجهة الدائنة ضده، أو هدّد رسمياً بذلك ("${label}").',
      behaviorTpl: 'لا تتفاوض ولا تعد بأي تنازل، وجّه الملف فوراً لمراجعة بشرية/قانونية قبل أي رد إضافي بخصوص السداد.' },
  },
  {
    // Financial/legal claim from the customer (e.g. "عندي رخصة سارية"،
    // "التأمين كان ساري وقت الحادث") — same safety pattern as payment
    // claims: never auto-trusted from chat text alone, isTerminal routes
    // to human review so a person verifies against the real documents
    // before the recourse amount actually changes.
    test: l => l.includes('حذف مسترد'),
    meta: { status: null, isTerminal: true,
      meaningTpl: 'العميل قدّم معلومة تدعم إسقاط أو تعديل مبلغ الرجوع (رخصة سارية/تأمين ساري/تصحيح بالتقرير) — لم يُتحقق منها بعد ("${label}").',
      behaviorTpl: 'لا تسقط أو تعدّل أي مبلغ بناءً على كلامه فقط — اطلب المستند الداعم ووجّه الملف لمراجعة بشرية قبل أي تحديث فعلي.' },
  },
  {
    test: l => l.includes('خدمة مفصولة'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل صرّح أن الخدمة مقطوعة/موقوفة فعلياً على حسابه ("${label}").',
      behaviorTpl: 'وضّح أن قطع الخدمة لا يُسقط المديونية المستحقة قبل القطع، وتابع بخصوص السداد بشكل طبيعي.' },
  },
  {
    test: l => l.includes('تم ابلاغ العميل') || l.includes('تم إبلاغ العميل'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'تم إبلاغ العميل فعلياً بتفاصيل المديونية المستحقة عليه لأول مرة في هذه المحادثة ("${label}").',
      behaviorTpl: 'هذا تسجيل لحدث حصل فعلاً (الإبلاغ)، لا يتطلب رداً إضافياً بحد ذاته — تابع المحادثة بشكل طبيعي.' },
  },
  {
    test: l => l.includes('تم نقل المديونية'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل صرّح بوضوح أن المديونية نُقلت أو حُوّلت لجهة/شخص آخر ("${label}").',
      behaviorTpl: 'وثّق التفاصيل التي ذكرها العميل عن جهة النقل، ووجّه الملف للمراجعة الإدارية لتأكيد النقل رسمياً.' },
  },
  {
    // Broad "an administrative note was recorded based on this real
    // exchange" bucket — covers update/error-acknowledgment/contact-method
    // categories that don't change debt status, but ARE grounded in
    // something that actually happened in the conversation (not the old
    // generic catch-all, which applied even with zero real signal).
    test: l => l === 'تحديث' || l.includes('تم التحديث') || l.includes('تم التعريف بالخطأ')
      || l.includes('تم التواصل مع المشترك') || l.includes('تم التواصل عن طريق'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'تحديث إداري على الملف بناءً على معلومة فعلية ذكرها العميل في هذه المحادثة ("${label}").',
      behaviorTpl: 'سجّل المعلومة الجديدة التي ذكرها العميل بدقة، ولا تغيّر حالة الدين بناءً على هذا وحده.' },
  },
  {
    test: l => l === 'متابعه' || l === 'متابعة',
    meta: { status: null, isTerminal: false,
      meaningTpl: 'حالة متابعة عامة — لا يوجد تطور جديد في هذه المحادثة يستدعي تصنيفاً أدق ("${label}").',
      behaviorTpl: 'تابع المحادثة بشكل طبيعي، لا تغيير مطلوب في الأسلوب.' },
  },
  {
    // Real gap the account owner flagged as the single most important
    // fix: explicit refusal — one of the most common and important real
    // outcomes — had NO differentiated meaning in 9 of 12 portfolios,
    // falling to the generic fallback like everything else.
    test: l => l.includes('رافض السداد') || l === 'رفض السداد',
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل رفض السداد بشكل صريح وقاطع، بدون أي التزام أو نية للتفاوض ("${label}").',
      behaviorTpl: 'لا تكرر نفس الطلب بنفس الأسلوب — إما تصعيد لهجة الجدية بحدود المهنية، أو استكشاف سبب الرفض إن لم يُذكر.' },
  },
  {
    test: l => l.includes('سدد جزء من المبلغ') || l.includes('طلب تفاصيل الاستهلاك') || l.includes('طلب تفاصيل الاشتراك'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل طلب تفاصيل استهلاكه أو اشتراكه بشكل صريح ("${label}").',
      behaviorTpl: 'وضّح أن التفاصيل الدقيقة تُطلب من الجهة الدائنة مباشرة أو عبر كشف حساب، وتابع بخصوص السداد.' },
  },
  {
    test: l => l.includes('يرغب بالتواصل مع الشركة'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل طلب صراحةً التواصل المباشر مع الجهة الدائنة نفسها بدلاً من المحصّل ("${label}").',
      behaviorTpl: 'زوّده بقنوات التواصل الرسمية للجهة إن توفرت، ووثّق الطلب للمتابعة الإدارية.' },
  },
  {
    test: l => l.includes('سوف يرفع شكوى'),
    meta: { status: null, isTerminal: true,
      meaningTpl: 'العميل هدّد صراحةً أو أعلن نيته برفع شكوى رسمية ("${label}").',
      behaviorTpl: 'حافظ على أسلوب مهني هادئ، لا تصعّد الموقف، ووجّه الملف لمراجعة بشرية فورية.' },
  },
  {
    test: l => l.includes('باع العقار و المديونية مازالت باسمه') || l.includes('مديونية الحساب على المالك الجديد') || l.includes('مديونية الحساب على المستأجر'),
    meta: { status: 'disputed', isTerminal: false,
      meaningTpl: 'العميل صرّح بوضوح بنقل ملكية العقار/السكن، مع بقاء أو انتقال المديونية بحسب كلامه ("${label}").',
      behaviorTpl: 'وثّق تفاصيل النقل التي ذكرها (تاريخ البيع/الإخلاء، المالك أو المستأجر الجديد إن ذكره)، ووجّه الملف للمراجعة الإدارية للتحقق قبل أي تعديل فعلي.' },
  },
  {
    test: l => l.includes('المديونية لجهة حكومية'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل صرّح بوضوح أن الحساب/العقار تابع لجهة حكومية ("${label}").',
      behaviorTpl: 'وثّق التفاصيل ووجّه الملف للمراجعة الإدارية، فالتعامل مع جهة حكومية يختلف عن العميل الفردي.' },
  },
  {
    test: l => l.includes('مطور عقاري بحاجة لتفاصيل الموقع'),
    meta: { status: null, isTerminal: true,
      meaningTpl: 'المتصل صرّح بأنه مطور عقاري يبحث عن المستفيد الفعلي بخصوص موقع معيّن — ليس المدين نفسه بالضرورة ("${label}").',
      behaviorTpl: 'حالة نادرة ومحددة — لا تكمل محادثة تحصيل عادية، وجّه فوراً لمراجعة بشرية للتحقق من هوية المتصل وغرضه.' },
  },
  {
    test: l => l.includes('يتهرب من الاتصال'),
    meta: { status: 'in_negotiation', isTerminal: false,
      meaningTpl: 'العميل أظهر نمطاً متكرراً وموثّقاً من تجنّب الرد/التواصل عبر عدة محاولات سابقة ("${label}") — وليس مجرد رد متأخر مرة واحدة.',
      behaviorTpl: 'كن مباشراً وواضحاً في طلب رد فعلي، ولا تفترض هذا التصنيف من مجرد بطء رد واحد.' },
  },
  {
    test: l => l.includes('يراجع الفرع'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل صرّح بأنه سيراجع أو راجع فرع الشركة شخصياً بخصوص هذا الملف ("${label}").',
      behaviorTpl: 'أفهمه أن الموضوع مسجّل، ولا تكرر المطالبة بنفس الطريقة حتى تُعرف نتيجة مراجعته للفرع.' },
  },
]

const DEFAULT_META = (label: string): OutcomeMeta => ({
  status: null, isTerminal: false,
  meaning: `حالة عامة محدَّثة على الملف ("${label}").`,
  behavior: 'تابع المحادثة بشكل طبيعي، لا تغيير مطلوب في الأسلوب.',
})

function buildOutcomeMeta(categories: string[]): Record<string, OutcomeMeta> {
  const out: Record<string, OutcomeMeta> = {}
  for (const label of categories) {
    const rule = OUTCOME_RULES.find(r => r.test(label))
    out[label] = rule
      ? {
          status: rule.meta.status,
          isTerminal: rule.meta.isTerminal,
          aiExcluded: rule.meta.aiExcluded,
          meaning: rule.meta.meaningTpl.replace('${label}', label),
          behavior: rule.meta.behaviorTpl,
        }
      : DEFAULT_META(label)
  }
  return out
}

const RAW_PROFILES: Omit<CompanyImportProfile, 'outcomeMeta'>[] = [
  {
    key: 'mobily', nameAr: 'موبايلي', nameEn: 'Mobily', category: 'telecom',
    aliases: ['mobily', 'موبايلي', 'موبايلى'],
    columnAliases: { 'city': 'city', 'email': 'email', 'nationality': 'national_id_type' },
    outcomeCategories: [
      'الرقم مغلق', 'العميل رافض السداد', 'العميل وعد بالسداد', 'العميل يتهرب من الاتصال',
      'العميل يراجع الفرع', 'تحديث', 'تم ابلاغ العميل بالمديونية', 'تم التحديث',
      'تم التواصل عن طريق الإيميل – واتساب', 'تم التواصل مع العميل و تم السداد',
      'تم التواصل مع قريب او صديق العميل', 'خروج نهائى', 'رقم التواصل غير صحيح',
      'سداد جزئى', 'لم يتم الرد', 'متوفي',
    ],
  },
  {
    key: 'stc', nameAr: 'إس تي سي', nameEn: 'STC', category: 'telecom',
    aliases: ['stc', 'إس تي سي', 'اس تي سي'],
    outcomeCategories: [
      'الرقم مغلق', 'بينات غير صحيحة', 'تم ابلاغ العميل', 'تم التحديث', 'تم السداد',
      'خدمة مفصولة', 'خروج نهائى', 'سداد جزئى', 'لم يتم الرد', 'متوفي',
      'معترض على المديونية', 'مماطل', 'وعد بالسداد',
    ],
  },
  {
    key: 'saudi_energy', nameAr: 'السعودية للطاقة', nameEn: 'Saudi Energy', category: 'government',
    aliases: ['السعودية للطاقة', 'الطاقة السعودية', 'saudi energy'],
    columnAliases: {
      'last invoice date': 'due_date', 'last payment date': 'last_payment_date',
      'e-mail address': 'email', 'account status': 'status',
      'نوع الحساب': 'product_type', 'installation blocking reason_3': 'notes',
    },
    outcomeCategories: [
      'الرقم خطأ', 'الرقم مغلق', 'الشركة مفلسه', 'المديونية لجهة حكومية',
      'المشترك باع العقار و المديونية مازالت باسمه', 'المشترك بيفيد بالسداد',
      'المشترك رافض السداد', 'المشترك سدد جزء من المبلغ', 'المشترك سوف يرفع شكوى',
      'المشترك طلب أقساط', 'المشترك طلب تسوية', 'المشترك طلب تفاصيل الاستهلاك',
      'المشترك طلب مهلة للسداد', 'المشترك متوفي', 'المشترك مسجون',
      'المشترك معترض على مبلغ الفاتورة', 'المشترك وعد بالسداد',
      'المشترك يرغب بالتواصل مع الشركة', 'تم التحديث', 'تم التعريف بالخطأ',
      'تم التواصل عن طريق الإيميل – واتساب', 'تم التواصل مع المشترك', 'تم نقل المديونية',
      'خروج نهائى', 'سداد جزئى', 'لا يوجد بيانات تواصل بالمشترك', 'لم يتم الرد',
      'مديونية الحساب على المالك الجديد', 'مديونية الحساب على المستأجر',
      'مطور عقاري بحاجة لتفاصيل الموقع للوصول إلى المستفيد الفعلي',
    ],
  },
  {
    key: 'national_water', nameAr: 'المياه الوطنية', nameEn: 'National Water', category: 'utility',
    aliases: ['المياه الوطنية', 'national water'],
    columnAliases: { 'آخر تاريخ فاتورة': 'due_date', 'آخر تاريخ دفع': 'last_payment_date', 'آخر دفع': 'last_payment_date', 'المدينة': 'city' },
    outcomeCategories: [
      'الرقم مغلق', 'العميل يتهرب من الاتصال', 'العميل يراجع الفرع', 'المديونية لجهة حكومية',
      'المشترك طلب مهلة للسداد', 'المشترك معترض على مبلغ الفاتورة', 'تم التحديث',
      'تم التواصل مع المشترك', 'تم السداد', 'خدمة مفصولة', 'رفض السداد',
      'رقم التواصل غير صحيح', 'سداد جزئى', 'لم يتم الرد', 'متوفي',
      'مديونية الحساب على المالك الجديد', 'مديونية الحساب على المستأجر', 'مماطل', 'وعد بالسداد',
    ],
  },
  {
    key: 'alam_tam', nameAr: 'علم - تم', nameEn: 'Alam Tam', category: 'government',
    aliases: ['علم تم', 'علم - تم', 'alam tam', 'alam-tam'],
    columnAliases: { 'end date': 'due_date', 'الموقع': 'city', 'اسم المالك': 'notes' },
    outcomeCategories: [
      'الرقم خطأ', 'الرقم مغلق', 'العميل رافض السداد', 'العميل وعد بالسداد',
      'المشترك طلب تفاصيل الاشتراك', 'المشترك طلب مهلة للسداد', 'تم التحديث',
      'تم التواصل مع قريب او صديق العميل', 'تم السداد', 'سداد جزئى', 'لم يتم الرد',
      'متوفي', 'مرفوعه قانونيا', 'مماطل',
    ],
  },
  // Both insurance companies share the same generic insurance-sector outcome
  // list ("قطاع التأمين") — confirmed: التعاونية و ميدغلف هما شركتا تأمين منفصلتان.
  {
    key: 'taawuniya', nameAr: 'التعاونية (طرف ثالث + حق رجوع)', nameEn: 'Tawuniya', category: 'insurance',
    aliases: ['التعاونية', 'التعاونية ( طرف ثالث + حق رجوع )', 'tawuniya', 'taawuniya'],
    columnAliases: { 'رقم جوال المالك': 'phone', 'اسم المالك': 'notes', 'تاريخ الحادث': 'due_date' },
    outcomeCategories: [
      'العميل رافض السداد', 'العميل وعد بالسداد', 'تفاوض على السداد', 'حذف مسترد تعديل تقرير',
      'حذف مسترد وجود رخصه / تجديد', 'حذف مسترد / وجود تامين', 'خروج نهائى', 'سداد جزئى',
      'سداد جزئى متعثر', 'سداد كامل', 'سداد كامل بخصم', 'لم يتم التواصل', 'لم يتم الرد',
      'متابعه', 'متوفي', 'مماطل', 'مهلة للسداد', 'نواقص مستندات',
    ],
  },
  {
    key: 'midgulf', nameAr: 'ميدغلف', nameEn: 'MidGulf', category: 'insurance',
    aliases: ['ميدغلف', 'midgulf', 'mid gulf'],
    columnAliases: { 'رقم جوال المالك': 'phone', 'اسم المالك': 'notes', 'تاريخ الحادث': 'due_date' },
    outcomeCategories: [
      'العميل رافض السداد', 'العميل وعد بالسداد', 'تفاوض على السداد', 'حذف مسترد تعديل تقرير',
      'حذف مسترد وجود رخصه / تجديد', 'حذف مسترد / وجود تامين', 'خروج نهائى', 'سداد جزئى',
      'سداد جزئى متعثر', 'سداد كامل', 'سداد كامل بخصم', 'لم يتم التواصل', 'لم يتم الرد',
      'متابعه', 'متوفي', 'مماطل', 'مهلة للسداد', 'نواقص مستندات',
    ],
  },
  {
    key: 'mahara_recruitment', nameAr: 'مهارة للاستقدام', nameEn: 'Mahara Recruitment', category: 'recruitment',
    aliases: ['مهارة للاستقدام', 'mahara', 'mahara recruitment'],
    columnAliases: { 'مبلغ المديونية الحالي': 'current_balance', 'الفرع': 'city', 'تاريخ انتهاء التعاقد': 'due_date' },
    outcomeCategories: [
      'الرقم مغلق', 'الشركة مفلسه', 'أنكر وجود مديونية', 'تم ابلاغ العميل', 'تم السداد',
      'رفض السداد', 'رقم التواصل غير صحيح', 'سداد جزئى', 'لم يتم الرد', 'مماطل', 'وعد بالسداد',
    ],
  },
  {
    key: 'wafrh', nameAr: 'WAFRH', nameEn: 'WAFRH', category: 'agriculture',
    aliases: ['wafrh'],
    columnAliases: { 'المندوب': 'collector_name', 'المدينة': 'city' },
    outcomeCategories: [
      'لا يوجد بيانات تواصل بالمشترك', 'المشترك رافض السداد', 'المشترك طلب اقساط',
      'تم التواصل عن طريق الايميل - واتساب', 'الشركة مفلسة', 'تم السداد',
      'المشترك طلب مهلة للسداد', 'المشترك سدد جزء من المبلغ', 'المشترك طلب تفاصيل الاستهلاك',
      'لم يتم الرد', 'الرقم خطأ', 'انكر وجود مديونية',
    ],
  },
  {
    key: 'tanmiya_agri', nameAr: 'التنمية الزراعية', nameEn: 'Agricultural Development', category: 'agriculture',
    aliases: ['التنمية الزراعية', 'agricultural development'],
    columnAliases: { 'تاريخ المديونية': 'due_date', 'المدينة': 'city', 'تم اتخاذ إجراء قانوني': 'notes' },
    outcomeCategories: [
      'لا يوجد بيانات تواصل بالمشترك', 'المشترك رافض السداد', 'المشترك طلب اقساط',
      'تم التواصل عن طريق الايميل - واتساب', 'الشركة مفلسة', 'تم السداد',
      'المشترك طلب مهلة للسداد', 'المشترك سدد جزء من المبلغ', 'المشترك طلب تفاصيل الاستهلاك',
      'لم يتم الرد', 'الرقم خطأ', 'انكر وجود مديونية',
    ],
  },
  {
    key: 'arabian_fisheries', nameAr: 'العربية للأسماك', nameEn: 'Arabian Fisheries', category: 'agriculture',
    aliases: ['العربية للاسماك', 'العربية للأسماك', 'arabian fisheries'],
    columnAliases: { 'تاريخ المديونية': 'due_date', 'المندوب': 'collector_name', 'المدينة': 'city', 'تم اتخاذ إجراء قانوني': 'notes' },
    outcomeCategories: [
      'المشترك طلب تفاصيل الاستهلاك', 'المشترك رافض السداد', 'المشترك سدد جزء من المبلغ',
      'الرقم خطأ', 'المشترك طلب مهلة للسداد', 'تم التواصل عن طريق الايميل - واتساب',
      'الشركة مفلسة', 'لم يتم الرد', 'لا يوجد بيانات تواصل بالمشترك', 'المشترك طلب اقساط',
      'انكر وجود مديونية',
    ],
  },
  {
    key: 'kunhul_agri', nameAr: 'كناهل الزراعية', nameEn: 'Kunhul Agriculture', category: 'agriculture',
    aliases: ['كناهل الزراعية', 'kunhul'],
    columnAliases: { 'مبلغ المديونية الحالي': 'current_balance', 'حالة العميل': 'status', 'customer city': 'city' },
    outcomeCategories: [
      'الرقم مغلق', 'تفاوض علي السداد', 'لا يوجد بيانات تواصل بالمشترك', 'مماطل',
      'رفض السداد', 'سداد كامل بخصم', 'وعد بالسداد', 'لم يتم الرد', 'المشترك طلب اقساط',
      'مهلة للسداد', 'الشركة مفلسة', 'تم السداد', 'سداد جزئي', 'سداد جزئي متعثر', 'انكر وجود مديونية',
    ],
  },
]

export const COMPANY_IMPORT_PROFILES: CompanyImportProfile[] = RAW_PROFILES.map(p => ({
  ...p,
  outcomeMeta: buildOutcomeMeta(p.outcomeCategories),
}))

export function findCompanyProfile(key: string): CompanyImportProfile | null {
  return COMPANY_IMPORT_PROFILES.find(p => p.key === key) ?? null
}

// Best-effort resolution from a free-text name (e.g. a filename or a
// portfolio name already in the DB) to a known profile, via alias match.
export function resolveCompanyProfile(text: string): CompanyImportProfile | null {
  const t = norm(text)
  for (const p of COMPANY_IMPORT_PROFILES) {
    if (p.aliases.some(a => t.includes(norm(a)))) return p
  }
  return null
}
