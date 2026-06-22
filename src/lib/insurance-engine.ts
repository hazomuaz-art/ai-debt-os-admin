// ════════════════════════════════════════════════════════════════════
//  Insurance Engine — Phase 3
//
//  Classifies an insurance claim into one of two types (حق رجوع / طرف
//  ثالث) PURELY from which fields actually exist in customer_data_tawuniya
//  / customer_data_medgulf — never a guess, never an LLM call. If the data
//  needed to classify isn't there, the claim type is null and NOTHING
//  insurance-specific is surfaced to the model at all.
//
//  "حذف مسترد" is NOT a classification this engine ever confirms — it is
//  a REVIEW TRIGGER only. The engine has no way to read/compare an
//  uploaded document's actual content (that is the separate, currently
//  out-of-scope PDF/OCR pipeline), so any sign that the customer is
//  contesting the claim reason with counter-evidence is routed to
//  human review, never resolved automatically.
// ════════════════════════════════════════════════════════════════════

export type InsuranceClaimType = 'recourse' | 'third_party' | null

export type InsuranceCaseFile = {
  claim_type: InsuranceClaimType
  recourse_reason: string | null
  fault_percentage: number | null
  recovery_number: string | null
  accident_date: string | null
  accident_city: string | null
  vehicle_type: string | null
  plate_number: string | null
  owner_national_id: string | null
  traffic_dept: string | null
}

function hasAccidentData(row: Record<string, any>): boolean {
  return !!(row.recovery_number || row.accident_date || row.accident_city || row.plate_number)
}

// Deterministic rule, driven ONLY by which columns are actually populated:
// - recourse_reason filled  -> the file records a specific policy-violation
//   reason the company used to recover from the at-fault party = حق رجوع.
// - no recourse_reason but real accident data exists -> no policy-violation
//   reason on file at all = طرف ثالث (no active/relevant policy basis).
// - no accident data at all -> not enough data to classify; return null and
//   surface NOTHING insurance-specific (never guess).
export function classifyInsuranceCase(row: Record<string, any> | null | undefined): InsuranceCaseFile {
  const r = row ?? {}
  const reason = r.recourse_reason ? String(r.recourse_reason).trim() : null
  const accident = hasAccidentData(r)

  let claim_type: InsuranceClaimType = null
  if (reason) claim_type = 'recourse'
  else if (accident) claim_type = 'third_party'

  return {
    claim_type,
    recourse_reason: reason,
    fault_percentage: r.fault_percentage ?? null,
    recovery_number: r.recovery_number ?? null,
    accident_date: r.accident_date ?? null,
    accident_city: r.accident_city ?? null,
    vehicle_type: r.vehicle_type ?? null,
    plate_number: r.plate_number ?? null,
    owner_national_id: r.owner_national_id ?? null,
    traffic_dept: r.traffic_dept ?? null,
  }
}

function hasAny(text: string, words: string[]) {
  const v = String(text ?? '').trim().toLowerCase()
  return words.some(w => v.includes(w.toLowerCase()))
}

export type InsuranceObjectionSignals = {
  // Customer objects to the recourse reason or the fault percentage itself
  // — must NEVER be resolved by the model, always sent to human review.
  objectsToRecourseOrFault: boolean
  // Customer asserts a fact that contradicts the claim reason on file and
  // implies they have/are sending evidence for it (e.g. claim says "no
  // valid license", customer says "my license was valid, I'll send it") —
  // this is the actual "حذف مسترد" trigger: a contested reason + a
  // counter-evidence claim, NOT just "an attachment exists somewhere".
  contradictsClaimReason: boolean
}

export function detectInsuranceObjectionSignals(text: string): InsuranceObjectionSignals {
  return {
    objectsToRecourseOrFault: hasAny(text, [
      'نسبة الخطأ', 'سبب الرجوع', 'حق الرجوع', 'ليش رجعتوا علي', 'ما وافقت على هذا',
      'هذا غلط', 'مو صحيح', 'اعتراض', 'وثيقة التأمين', 'كان عندي تأمين',
    ]),
    contradictsClaimReason: hasAny(text, [
      'رخصتي سارية', 'عندي رخصة', 'كان عندي تأمين ساري', 'تأميني كان ساري',
      'هذا غير صحيح وعندي', 'راح ارسل لك', 'بترسل لك', 'سأرسل', 'مستند يثبت',
      'وثيقة تثبت', 'عندي إثبات', 'عندي اثبات', 'يثبت العكس', 'هذا يثبت',
    ]),
  }
}

// Text block injected into the system prompt — ONLY when category is
// actually 'insurance' AND a claim_type was classified. Renders nothing
// (caller must skip the section entirely) when claim_type is null.
export function renderInsuranceCaseFile(c: InsuranceCaseFile): string {
  const lines: string[] = []
  lines.push(`- نوع المطالبة: ${c.claim_type === 'recourse' ? 'حق رجوع (كان للعميل تأمين وقت الحادث لكن سقط حقه بالتغطية بسبب مخالفة شرط من الوثيقة، والشركة عوّضت المتضرر ثم رجعت على العميل)' : 'طرف ثالث (لا يوجد تأمين ساري وقت الحادث أو لا يوجد تأمين أساساً، والشركة عوّضت المتضرر ثم تطالب العميل)'}`)
  if (c.recourse_reason) lines.push(`- سبب الرجوع المسجَّل: ${c.recourse_reason}`)
  if (c.fault_percentage != null) lines.push(`- نسبة الخطأ المسجَّلة: ${c.fault_percentage}%`)
  if (c.recovery_number) lines.push(`- رقم الحادث/المطالبة: ${c.recovery_number}`)
  if (c.accident_date) lines.push(`- تاريخ الحادث: ${c.accident_date}`)
  if (c.accident_city) lines.push(`- مدينة الحادث: ${c.accident_city}`)
  if (c.plate_number) lines.push(`- رقم اللوحة: ${c.plate_number}`)
  lines.push('- 🔴🔴 أي اعتراض من العميل على سبب الرجوع أو نسبة الخطأ أو أي مستند يخص الحادث: لا تحسمه أنت، لا توافق ولا ترفض — فقط أكّد أنك ستفتح مراجعة للملف.')
  lines.push('- 🔴 ممنوع أن تقرر أو تلمّح بأن المطالبة سقطت أو أُلغيت — هذا قرار بشري بعد المراجعة فقط.')
  return lines.join('\n')
}
