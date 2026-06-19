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

export type CompanyImportProfile = {
  key:               string
  nameAr:            string
  nameEn?:           string
  category:          PortfolioCategory
  aliases:           string[]          // lowercased, trimmed
  columnAliases?:    Record<string, string>  // lowercased header -> standard field
  outcomeCategories: string[]
}

const norm = (s: string) => s.toLowerCase().trim()

export const COMPANY_IMPORT_PROFILES: CompanyImportProfile[] = [
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
