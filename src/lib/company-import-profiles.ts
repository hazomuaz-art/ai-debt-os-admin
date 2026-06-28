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
    test: l => l.includes('سداد كامل') || (l.includes('تم السداد') && !l.includes('جزئ')),
    meta: { status: 'settled', isTerminal: false,
      meaningTpl: 'تم سداد المديونية بالكامل ("${label}").',
      behaviorTpl: 'اشكر العميل وأغلق الموضوع بلطف، لا تطلب أي سداد إضافي.' },
  },
  {
    test: l => l.includes('سداد جزئ'),
    meta: { status: 'partial', isTerminal: false,
      meaningTpl: 'العميل سدد جزءاً من المديونية فقط ("${label}").',
      behaviorTpl: 'اشكره على الجزء المسدد، واسأل بلطف عن موعد تسديد الباقي.' },
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
    test: l => l.includes('طلب أقساط') || l.includes('طلب اقساط') || l.includes('طلب مهلة') || l.includes('طلب تسوية') || l.includes('تفاوض'),
    meta: { status: null, isTerminal: false,
      meaningTpl: 'العميل طلب تقسيطاً أو تسوية أو مهلة ("${label}") — يحتاج موافقة إدارة.',
      behaviorTpl: 'أفهمه أن طلبه رُفع للمراجعة، لا توافق على أي تقسيط أو تسوية من عندك مباشرة.' },
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
    columnAliases: { 'end date': 'due_date', 'الموقع': 'city' },
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
