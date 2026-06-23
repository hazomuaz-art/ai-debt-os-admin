// ════════════════════════════════════════════════════════════════════
// Mobily Operational Knowledge
//
// Parallels src/lib/stc-knowledge.ts — pure field-semantics + a
// deterministic, safety-critical "which number does this customer pay
// with" resolver for the Mobily portfolio's customer_data_mobily columns
// (see supabase/migrations/022_portfolio_customer_data_tables.sql and
// src/lib/portfolio-data-fields.ts). Does NOT touch policy
// (forbidden_phrases / escalation rules live in the DB playbook row).
//
// The critical rule: the payment number to GIVE the customer depends on
// the service status — Inactive (temporary disconnect) → Service Number
// (product_number); Closed (full disconnect) → Account Number. Giving the
// wrong one can post the payment to the wrong account, so it is resolved
// here in code (deterministic) rather than left to the model to infer.
// ════════════════════════════════════════════════════════════════════

export type MobilyServiceStatus = 'closed' | 'inactive'

// Classifies the raw service_status value. Closed = full disconnect,
// Inactive = temporary disconnect. Returns null for any other/missing
// value — never guessed beyond these two known states.
export function classifyMobilyServiceStatus(serviceStatus: string | null | undefined): MobilyServiceStatus | null {
  const v = String(serviceStatus ?? '').trim().toLowerCase()
  if (!v) return null
  if (v === 'closed' || v.includes('مغلق') || v.includes('فصل كلي') || v.includes('فصل نهائي')) return 'closed'
  if (v === 'inactive' || v.includes('غير نشط') || v.includes('موقوف') || v.includes('فصل مؤقت')) return 'inactive'
  return null
}

// Plain-language explanations of each customer_data_mobily field — used to
// render the case-file knowledge block and to answer a direct customer
// question about what a field means, without ever escalating.
export const MOBILY_FIELD_EXPLANATIONS: Record<string, string> = {
  account_number: 'رقم الحساب: رقم الحساب المالي الخاص بالعميل لدى موبايلي.',
  product_number: 'رقم الخدمة: رقم الخدمة/الشريحة المرتبطة بالمديونية.',
  sadad_number: 'رقم السداد: رقم السداد/المفوتر المستخدم في الدفع.',
  service_status: 'حالة الخدمة: Closed تعني فصل كلي للخدمة، وInactive تعني فصل مؤقت.',
  created_date: 'تاريخ تفعيل الخدمة: تاريخ بدء/تفعيل الخدمة لدى العميل.',
  status_date: 'تاريخ حالة المديونية: تاريخ تغيّر حالة الحساب/المديونية.',
  mnp: 'حالة نقل الرقم (MNP): توضّح إن كان الرقم منقولاً لمشغّل آخر.',
  category: 'فئة العميل: تصنيف العميل في نظام موبايلي.',
}

// Detects a Mobily customer asking about the MEANING of one of the
// portfolio's operational fields. MUST only ever be called when
// isMobilyPortfolio is true (these phrases are common everyday Arabic).
const MOBILY_FIELD_MEANING_WORDS = [
  'رقم الخدمة', 'رقم خدمتي', 'رقم حسابي', 'رقم الحساب', 'رقم السداد', 'رقم سداد',
  'حالة الخدمة', 'حالة الحساب', 'تاريخ التفعيل', 'تاريخ تفعيل', 'نقل الرقم',
  'تاريخ المديونية', 'فئة العميل',
]

export function detectMobilyFieldMeaningQuestion(text: string): boolean {
  const v = String(text ?? '').trim().toLowerCase()
  return MOBILY_FIELD_MEANING_WORDS.some(w => v.includes(w.toLowerCase()))
}

// Resolves the SINGLE correct payment number for this customer based on
// service status. Returns null when the status is unknown or the needed
// number is missing — the caller must then NOT assert a number (verify
// instead), never guess.
export function resolveMobilyPaymentNumber(
  row: Record<string, any> | null | undefined
): { kind: 'service_number' | 'account_number'; value: string } | null {
  if (!row) return null
  const status = classifyMobilyServiceStatus(row.service_status)
  if (status === 'inactive' && row.product_number) {
    return { kind: 'service_number', value: String(row.product_number) }
  }
  if (status === 'closed' && row.account_number) {
    return { kind: 'account_number', value: String(row.account_number) }
  }
  return null
}

// Renders the Mobily-only knowledge block injected into the case file:
// service status meaning, the deterministically-resolved correct payment
// number, and a short explanation of each field present on the row.
export function renderMobilyKnowledgeForCaseFile(row: Record<string, any> | null | undefined): string {
  if (!row) return ''
  const lines: string[] = []
  lines.push('')
  lines.push('【 معرفة تشغيلية خاصة بموبايلي — اقرأها قبل الرد، واشرح الحقول للعميل مباشرة منها إذا سأل بدون تصعيد 】')

  const status = classifyMobilyServiceStatus(row.service_status)
  if (status === 'closed') lines.push('- حالة الخدمة: Closed (فصل كلي للخدمة).')
  else if (status === 'inactive') lines.push('- حالة الخدمة: Inactive (فصل مؤقت للخدمة).')

  const pay = resolveMobilyPaymentNumber(row)
  if (pay) {
    const label = pay.kind === 'service_number' ? 'رقم الخدمة' : 'رقم الحساب'
    lines.push(`- 🔴 رقم السداد الصحيح لهذا العميل حسب حالة الخدمة هو ${label}: ${pay.value}. أعطه هذا الرقم فقط عند سؤاله عن طريقة السداد — إعطاء الرقم الخطأ قد يسجّل السداد على حساب خاطئ.`)
  } else if (status) {
    lines.push('- 🔴 لم يتوفر الرقم الصحيح للسداد حسب حالة الخدمة — لا تعطِ العميل أي رقم سداد، ووضّح له أنك ستتحقق وتزوّده بالرقم الصحيح.')
  }

  if (row.account_number) lines.push(`- ${MOBILY_FIELD_EXPLANATIONS.account_number}`)
  if (row.product_number) lines.push(`- ${MOBILY_FIELD_EXPLANATIONS.product_number}`)
  if (row.sadad_number) lines.push(`- ${MOBILY_FIELD_EXPLANATIONS.sadad_number}`)
  if (row.service_status) lines.push(`- ${MOBILY_FIELD_EXPLANATIONS.service_status}`)
  if (row.created_date) lines.push(`- ${MOBILY_FIELD_EXPLANATIONS.created_date}`)
  if (row.status_date) lines.push(`- ${MOBILY_FIELD_EXPLANATIONS.status_date}`)
  if (row.mnp) lines.push(`- ${MOBILY_FIELD_EXPLANATIONS.mnp}`)

  return lines.length > 1 ? lines.join('\n') : ''
}
