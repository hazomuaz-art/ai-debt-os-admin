// ════════════════════════════════════════════════════════════════════
// STC Operational Knowledge — Phase 6 (small)
//
// Pure field-semantics knowledge for the STC portfolio's customer_data_stc
// columns (see supabase/migrations/022_portfolio_customer_data_tables.sql
// and src/lib/portfolio-data-fields.ts). Does NOT touch policy — no
// forbidden phrases, no escalation rules, no payment-method logic. Only
// lets the agent explain what a field MEANS when the customer asks, and
// surfaces the inferred service type / device-bundling status into the
// case file so it never has to guess or deflect.
//
// "Service Number" here is customer_data_stc.product_number — the only
// STC-specific field that holds the phone/internet/data line associated
// with the debt; there is no separate "service_number" column in the
// schema, so product_number is the canonical source.
// ════════════════════════════════════════════════════════════════════

export type StcServiceType = 'mobile' | 'landline_internet' | 'data_sim'

export const STC_SERVICE_TYPE_LABELS: Record<StcServiceType, string> = {
  mobile: 'جوال',
  landline_internet: 'إنترنت أرضي / منزلي',
  data_sim: 'شريحة بيانات',
}

// Classifies the STC service/product number by its first digit:
// 5 = mobile, 1 = landline/home internet, 8 = data SIM. Returns null when
// the number is missing or doesn't start with a recognised digit — never
// guessed beyond this fixed, deterministic rule.
export function classifyStcServiceType(serviceNumber: string | null | undefined): StcServiceType | null {
  const s = String(serviceNumber ?? '').trim()
  if (!s) return null
  const firstDigit = s[0]
  if (firstDigit === '5') return 'mobile'
  if (firstDigit === '1') return 'landline_internet'
  if (firstDigit === '8') return 'data_sim'
  return null
}

// Detects an STC customer asking about the MEANING of one of the
// portfolio's operational fields (service/account number, device-bundling
// status, status/establish dates, sadad number, late balance, service
// type). MUST only ever be called when isStcPortfolio is true — these
// phrases (e.g. "رقم الحساب") are common enough in everyday Arabic that
// matching them for every portfolio would misclassify unrelated questions.
const STC_FIELD_MEANING_WORDS = [
  'رقم الخدمة', 'رقم خدمتي', 'رقم حسابي', 'رقم الحساب', 'نوع الخدمة',
  'مع جهاز', 'بدون جهاز', 'بلا جهاز', 'باقة', 'بأقة', 'باقا', 'baqa',
  'تاريخ التعثر', 'تاريخ تعثر', 'حالة الحساب', 'تاريخ الحساب',
  'تاريخ تأسيس', 'تاريخ انشاء', 'تاريخ إنشاء', 'تأسيس العميل',
  'رقم سداد', 'رقم السداد', 'المتأخر', 'المبلغ المتأخر', 'الرصيد المتأخر',
]

export function detectStcFieldMeaningQuestion(text: string): boolean {
  const v = String(text ?? '').trim().toLowerCase()
  return STC_FIELD_MEANING_WORDS.some(w => v.includes(w.toLowerCase()))
}

// Plain-language explanations of each customer_data_stc field — used both
// to render the case-file knowledge block and to answer a direct customer
// question about what a field means, without ever escalating.
export const STC_FIELD_EXPLANATIONS: Record<string, string> = {
  account_number: 'رقم الحساب: هو رقم الحساب المالي الخاص بالعميل، يُستخدم للسداد والمتابعة المالية، ويختلف عن رقم الخدمة.',
  product_number: 'رقم الخدمة: هو رقم الخدمة المرتبطة بالمديونية (جوال، إنترنت أرضي/منزلي، أو شريحة بيانات).',
  customer_established_dt: 'تاريخ تأسيس العميل: تاريخ تأسيس الخدمة لدى العميل.',
  account_status_date: 'تاريخ حالة الحساب: تاريخ تعثّر الحساب أو تاريخ انتقاله للتحصيل.',
  baqa_flag: 'علامة الباقة (Baqa Flag): توضح إن كانت الخدمة مرتبطة بجهاز (نعم) أو بدون جهاز (لا).',
}

function isBaqaYes(baqaFlag: string | null | undefined): boolean | null {
  const v = String(baqaFlag ?? '').trim().toLowerCase()
  if (!v) return null
  if (['yes', 'y', 'نعم', '1', 'true'].includes(v)) return true
  if (['no', 'n', 'لا', '0', 'false'].includes(v)) return false
  return null
}

// Renders the STC-only knowledge block injected into the case file: the
// inferred service type, the device-bundling status, and a short
// explanation of each field actually present on this customer's row.
export function renderStcKnowledgeForCaseFile(stcRow: Record<string, any> | null | undefined): string {
  if (!stcRow) return ''
  const lines: string[] = []
  lines.push('')
  lines.push('【 معرفة تشغيلية خاصة بـ STC — اشرح هذي الحقول للعميل مباشرة من هنا إذا سأل، بدون تحويل أو تصعيد 】')

  const serviceType = classifyStcServiceType(stcRow.product_number)
  if (serviceType) {
    lines.push(`- نوع الخدمة المستنتج من رقم الخدمة (${stcRow.product_number}): ${STC_SERVICE_TYPE_LABELS[serviceType]}.`)
  }

  const baqaYes = isBaqaYes(stcRow.baqa_flag)
  if (baqaYes !== null) {
    lines.push(`- حالة الجهاز: ${baqaYes ? 'الخدمة مرتبطة بجهاز (نعم).' : 'الخدمة بدون جهاز (لا).'}`)
  }

  if (stcRow.account_number) lines.push(`- ${STC_FIELD_EXPLANATIONS.account_number}`)
  if (stcRow.product_number) lines.push(`- ${STC_FIELD_EXPLANATIONS.product_number}`)
  if (stcRow.customer_established_dt) lines.push(`- ${STC_FIELD_EXPLANATIONS.customer_established_dt}`)
  if (stcRow.account_status_date) lines.push(`- ${STC_FIELD_EXPLANATIONS.account_status_date}`)
  if (stcRow.baqa_flag) lines.push(`- ${STC_FIELD_EXPLANATIONS.baqa_flag}`)

  return lines.length > 1 ? lines.join('\n') : ''
}
