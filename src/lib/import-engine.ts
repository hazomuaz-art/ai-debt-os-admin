// ════════════════════════════════════════════════════════════════════════
// Generic Import Engine — column detection, layout clustering, and mapping
// resolution for debt-portfolio import files.
//
// Built to be GENERAL: it must work on any future file, not just files seen
// so far. Mapping decisions are based on column NAME + column CONTENT
// (data-shape, uniqueness) + relationships between columns + an optional
// known company profile + previously confirmed templates — NEVER on column
// position/order. No mapping is ever applied silently when uncertain; the
// caller decides (auto-accept on a clear confidence gap, otherwise surface
// the conflict for one-time human confirmation).
//
// Multi-layout files: a single sheet may stack rows from several different
// portfolios/sectors, each filling only ITS OWN subset of columns and
// leaving the rest blank. Rows are clustered by which columns are
// non-empty for them (their "active-column signature") — a purely
// structural, content-driven grouping — and mapping is resolved
// INDEPENDENTLY per cluster, so each row "type" gets its own correct
// column→field decision regardless of what other layouts in the same file
// need.
// ════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto'

export type StandardField =
  | 'full_name' | 'phone' | 'whatsapp' | 'national_id' | 'city' | 'employer'
  | 'monthly_income' | 'email'
  | 'original_amount' | 'current_balance' | 'currency' | 'due_date' | 'status'
  | 'priority' | 'product_type' | 'account_number' | 'reference_number'
  | 'notes' | 'collector_name' | 'portfolio_name'

// Fields the importer cannot proceed without (per cluster).
export const REQUIRED_FIELDS: StandardField[] = ['full_name']
// At least one of these amount fields must resolve per cluster.
export const REQUIRED_AMOUNT_FIELDS: StandardField[] = ['original_amount', 'current_balance']

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const stripInvisible = (s: string) => s.replace(/[​-‍﻿]/g, '')

// ── 1) Header dictionary (kept from the previous importer — exact + fuzzy) ──
// This is still ONE signal among several, not the sole decision-maker.

const HEADER_EXACT: Record<string, StandardField> = {
  'customer name': 'full_name', 'full name': 'full_name', 'name': 'full_name',
  'client name': 'full_name', 'client': 'full_name', 'customer': 'full_name',
  'debtor': 'full_name', 'debtor name': 'full_name', 'client full name': 'full_name',
  'اسم العميل': 'full_name', 'الاسم': 'full_name', 'الاسم الكامل': 'full_name',
  'الاسم بالكامل': 'full_name', 'اسم': 'full_name', 'العميل': 'full_name',
  'phone': 'phone', 'mobile': 'phone', 'telephone': 'phone',
  'الجوال': 'phone', 'رقم الجوال': 'phone', 'الهاتف': 'phone', 'رقم الهاتف': 'phone',
  'الموبايل': 'phone', 'رقم الموبايل': 'phone',
  'whatsapp': 'whatsapp', 'whatsapp number': 'whatsapp',
  'واتساب': 'whatsapp', 'رقم الواتساب': 'whatsapp', 'واتس': 'whatsapp',
  'national id': 'national_id', 'id number': 'national_id', 'iqama': 'national_id',
  'national id number': 'national_id',
  'الهوية': 'national_id', 'رقم الهوية': 'national_id', 'الهوية الوطنية': 'national_id',
  'رقم الهوية الوطنية': 'national_id', 'هوية': 'national_id', 'الإقامة': 'national_id',
  'city': 'city', 'region': 'city', 'المدينة': 'city', 'المنطقة': 'city', 'المحافظة': 'city',
  'employer': 'employer', 'company': 'employer', 'work': 'employer',
  'جهة العمل': 'employer', 'صاحب العمل': 'employer', 'الجهة': 'employer', 'العمل': 'employer',
  'monthly income': 'monthly_income', 'income': 'monthly_income', 'salary': 'monthly_income',
  'الراتب': 'monthly_income', 'الدخل': 'monthly_income', 'الدخل الشهري': 'monthly_income',
  'الراتب الشهري': 'monthly_income',
  'email': 'email', 'e-mail': 'email', 'البريد الالكتروني': 'email', 'الايميل': 'email', 'الإيميل': 'email',
  'amount': 'original_amount', 'original amount': 'original_amount', 'debt amount': 'original_amount',
  'loan amount': 'original_amount', 'total amount': 'original_amount', 'principal': 'original_amount',
  'debt': 'original_amount', 'loan': 'original_amount', 'principal amount': 'original_amount',
  'total debt': 'original_amount', 'claim amount': 'original_amount',
  'المبلغ': 'original_amount', 'المبلغ الأصلي': 'original_amount', 'قيمة الدين': 'original_amount',
  'مبلغ الدين': 'original_amount', 'إجمالي الدين': 'original_amount', 'الدين': 'original_amount',
  'مبلغ': 'original_amount', 'القيمة': 'original_amount',
  'balance': 'current_balance', 'current balance': 'current_balance', 'outstanding': 'current_balance',
  'remaining': 'current_balance', 'outstanding balance': 'current_balance', 'remaining balance': 'current_balance',
  'remaining amount': 'current_balance', 'remaining debt': 'current_balance', 'unpaid': 'current_balance',
  'unpaid amount': 'current_balance',
  'الرصيد': 'current_balance', 'الرصيد المتبقي': 'current_balance', 'المبلغ المتبقي': 'current_balance',
  'المتبقي': 'current_balance', 'الرصيد الحالي': 'current_balance', 'رصيد': 'current_balance',
  'المبلغ الباقي': 'current_balance',
  'currency': 'currency', 'العملة': 'currency',
  'due date': 'due_date', 'expiry date': 'due_date', 'maturity date': 'due_date',
  'تاريخ الاستحقاق': 'due_date', 'تاريخ السداد': 'due_date', 'الاستحقاق': 'due_date',
  'status': 'status', 'debt status': 'status', 'case status': 'status', 'collection status': 'status',
  'loan status': 'status', 'الحالة': 'status', 'حالة الدين': 'status', 'حالة القضية': 'status',
  'priority': 'priority', 'الأولوية': 'priority',
  'product': 'product_type', 'product type': 'product_type', 'service': 'product_type',
  'المنتج': 'product_type', 'نوع المنتج': 'product_type', 'الخدمة': 'product_type',
  'account number': 'account_number', 'account': 'account_number', 'contract': 'account_number',
  'contract number': 'account_number',
  'رقم الحساب': 'account_number', 'رقم العقد': 'account_number', 'حساب': 'account_number',
  'reference': 'reference_number', 'ref': 'reference_number', 'case number': 'reference_number',
  'case ref': 'reference_number',
  'رقم القضية': 'reference_number', 'المرجع': 'reference_number', 'رقم المرجع': 'reference_number',
  'notes': 'notes', 'description': 'notes', 'remarks': 'notes', 'comment': 'notes',
  'ملاحظات': 'notes', 'ملاحظة': 'notes', 'التعليق': 'notes', 'وصف': 'notes',
  'collector': 'collector_name', 'assigned to': 'collector_name',
  'المحصل': 'collector_name', 'اسم المحصل': 'collector_name',
  'portfolio': 'portfolio_name', 'المحفظة': 'portfolio_name', 'المشروع': 'portfolio_name',
  'الجهة الممولة': 'portfolio_name',
}

// Fuzzy keyword fallback — kept narrow on purpose. These ALONE never decide
// full_name (the most ambiguous field) — full_name fuzzy header hits are
// down-weighted and must be confirmed/broken-tied by content scoring below.
const FUZZY_RULES: Array<{ test: (h: string) => boolean; field: StandardField; weight: number }> = [
  { test: h => h.includes('اسم') && (h.includes('عميل') || h.includes('مستفيد') || h.includes('مالك') || h.includes('مدين')), field: 'full_name', weight: 0.45 },
  { test: h => h.includes('هوية') || h.includes('إقامة') || h.includes('اقامة'), field: 'national_id', weight: 0.7 },
  { test: h => h.includes('مبلغ') || h.includes('مديونية') || h.includes('مطالبة'), field: 'original_amount', weight: 0.6 },
  { test: h => h.includes('رصيد'), field: 'current_balance', weight: 0.6 },
  { test: h => h.includes('تواصل') || h.includes('جوال') || h.includes('هاتف') || h.includes('موبايل'), field: 'phone', weight: 0.6 },
  { test: h => h.includes('حساب') && !h.includes('نوع'), field: 'account_number', weight: 0.5 },
  { test: h => h.includes('عقد') || h.includes('مرجع'), field: 'reference_number', weight: 0.5 },
  { test: h => h.includes('محفظة') || h.includes('مشروع'), field: 'portfolio_name', weight: 0.6 },
  { test: h => h.includes('حالة') || h.includes('حاله'), field: 'status', weight: 0.5 },
  { test: h => h.includes('منتج') || h.includes('خدمة'), field: 'product_type', weight: 0.5 },
  { test: h => h.includes('ملاحظ') || h.includes('تعليق'), field: 'notes', weight: 0.5 },
  { test: h => h.includes('موعد') || h.includes('استحقاق') || h.includes('سداد'), field: 'due_date', weight: 0.4 },
  { test: h => h.includes('راتب') || h.includes('دخل'), field: 'monthly_income', weight: 0.5 },
  { test: h => h.includes('شركة') || h.includes('عمل') || h.includes('جهة'), field: 'employer', weight: 0.4 },
  { test: h => h.includes('مستخدم') || h.includes('محصل') || h.includes('مسؤول'), field: 'collector_name', weight: 0.4 },
]

function headerScore(header: string, field: StandardField): number {
  const h = stripInvisible(norm(header))
  if (HEADER_EXACT[h] === field) return 1.0
  let best = 0
  for (const r of FUZZY_RULES) {
    if (r.field === field && r.test(h)) best = Math.max(best, r.weight)
  }
  return best
}

// ── 2) Content plausibility scoring — the GENERAL fix for header ambiguity.
//      Looks at a sample of the column's actual values, never its name. ──

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)))
}

function uniquenessRatio(values: string[]): number {
  const nonEmpty = values.filter(v => v && v.trim())
  if (nonEmpty.length === 0) return 0
  return new Set(nonEmpty.map(v => v.trim())).size / nonEmpty.length
}

function fillRatio(values: string[]): number {
  if (values.length === 0) return 0
  return values.filter(v => v && v.trim()).length / values.length
}

function looksLikeName(v: string): boolean {
  const t = v.trim()
  if (!t || /\d/.test(t)) return false
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 4) return false
  // Reject values containing punctuation typically found in category/
  // portfolio labels (parentheses, plus signs, slashes) — a real person's
  // name is plain words, not an annotated label like "X ( نوع ب + ملاحظة )".
  if (/[()+/]/.test(t)) return false
  // Mostly letters (Arabic or Latin), allow short connectors (e.g. "بن", "-").
  return /^[؀-ۿa-zA-Z\s.'-]+$/.test(t)
}

function looksLikeNationalId(v: string): boolean {
  const d = toAsciiDigits(v.trim()).replace(/\D/g, '')
  return /^[12]\d{9}$/.test(d)
}

function looksLikePhone(v: string): boolean {
  const d = toAsciiDigits(v.trim()).replace(/\D/g, '')
  return /^(05|9665|966|5)\d{7,8}$/.test(d) || (d.length >= 9 && d.length <= 13)
}

// A header that reads as an identifier/reference NUMBER (SADAD number,
// invoice number, product number...) must never be claimed as an amount
// field (original_amount/current_balance) purely because its values happen
// to look numeric — confirmed real bug: a "Sadad_NUMBER" column (a billing
// reference id, e.g. 880001) had no header alias for any amount field, so
// it fell through to content-shape scoring alone, which can't distinguish
// a 6-digit reference number from a real balance. General fix, not specific
// to this one file: any header naming it a "number/ID/code" is excluded
// from amount-field candidacy unless it ALSO carries a real amount keyword.
function looksLikeIdentifierHeader(header: string): boolean {
  const h = stripInvisible(norm(header))
  const hasAmountWord = /مبلغ|رصيد|مديونية|دين|قيمة|amount|balance|debt|outstanding|remaining|unpaid/.test(h)
  if (hasAmountWord) return false
  return /sadad|سداد|invoice|فاتورة|\bid\b|\bno\.?\b|number|رقم|code|كود/.test(h)
}

function looksLikeAmount(v: string): boolean {
  const t = toAsciiDigits(v.trim()).replace(/[,،\s]/g, '')
  if (!/^\d+(\.\d+)?$/.test(t) || Number(t) <= 0) return false
  // Exclude fixed-width long digit strings (10-digit national IDs, phone
  // numbers) — real monetary amounts essentially never have exactly that
  // shape (no thousands separator left after stripping, no decimals, and a
  // suspiciously ID/phone-like length). General heuristic, not a list of
  // specific files/values.
  const intPart = t.split('.')[0]
  if (!t.includes('.') && intPart.length >= 9) return false
  return true
}

function looksLikeDate(v: string): boolean {
  const t = toAsciiDigits(v.trim())
  return /^\d{4}-\d{2}-\d{2}$/.test(t) || /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(t)
}

function looksLikeAlphaNumCode(v: string): boolean {
  const t = v.trim()
  if (!/^[A-Za-z0-9-_/]{3,20}$/.test(t)) return false
  // Reference/account/contract numbers are almost always either mixed
  // letters+digits or contain a separator — a column of plain long digit
  // runs (10-digit IDs, phone numbers) should NOT score here, or every
  // numeric identifier column in the file would falsely look like a
  // reference number. General shape rule, not specific to one file.
  const hasLetter = /[A-Za-z]/.test(t)
  const hasSeparator = /[-_/]/.test(t)
  if (!hasLetter && !hasSeparator && /^\d+$/.test(t) && t.length >= 9) return false
  return /\d/.test(t) || hasLetter
}

// Content score per field: combines a shape-match ratio over the sample with
// uniqueness/fill characteristics appropriate to that field. Returns 0-1.
function contentScore(field: StandardField, values: string[]): number {
  const sample = values.filter(v => v && v.trim())
  if (sample.length === 0) return 0
  const ratio = (test: (v: string) => boolean) => sample.filter(test).length / sample.length

  switch (field) {
    case 'full_name': {
      const shapeRatio = ratio(looksLikeName)
      const uniq = uniquenessRatio(values)
      // Names are free text AND almost always unique per row — REQUIRE BOTH
      // (multiplicative AND), not a weighted sum. A weighted sum let a purely
      // numeric column (shapeRatio=0) still score via uniqueness alone (phone
      // numbers and national IDs are highly unique too), and let a
      // low-shape-but-unique categorical column slip through. Neither signal
      // alone is sufficient; a real name column must satisfy both.
      return shapeRatio * uniq
    }
    case 'national_id':
      return ratio(looksLikeNationalId)
    case 'phone':
      return ratio(looksLikePhone)
    case 'original_amount':
    case 'current_balance':
    case 'monthly_income':
      return ratio(looksLikeAmount)
    case 'due_date':
      return ratio(looksLikeDate)
    case 'account_number':
    case 'reference_number':
      return Math.max(ratio(looksLikeAlphaNumCode), uniquenessRatio(values) * 0.5)
    case 'status': {
      // Status/category columns repeat a small fixed vocabulary — LOW
      // uniqueness is the expected, positive signal here (inverse of name).
      const uniq = uniquenessRatio(values)
      return sample.length >= 3 ? 1 - uniq : 0.3
    }
    case 'email':
      return ratio(v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()))
    default:
      return 0 // no strong content signal for free-text fields (notes, city, employer...) — header score alone decides
  }
}

// ── 3) Row clustering by active-column signature (structural, content-driven) ──

export type RowCluster = {
  signature: string[]      // sorted list of header names that are non-empty for these rows
  signatureHash: string
  rowIndices: number[]     // indices into the original `rows` array
}

function rowActiveHeaders(headers: string[], row: string[]): string[] {
  const active: string[] = []
  for (let i = 0; i < headers.length; i++) {
    if (row[i] && row[i].trim()) active.push(headers[i])
  }
  return active
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 1 : inter / union
}

export function hashSignature(headers: string[]): string {
  const norm_ = [...headers].map(h => stripInvisible(norm(h))).sort()
  return createHash('sha256').update(JSON.stringify(norm_)).digest('hex').slice(0, 24)
}

// Groups row indices into clusters of similar active-column signatures.
// Pure structural clustering — no knowledge of field meaning, company, or
// position; only "which columns are filled in for this row".
const CLUSTER_SIMILARITY_THRESHOLD = 0.6

export function clusterRowsByLayout(headers: string[], rows: string[][]): RowCluster[] {
  const clusters: Array<{ rep: Set<string>; rowIndices: number[] }> = []

  for (let r = 0; r < rows.length; r++) {
    const active = new Set(rowActiveHeaders(headers, rows[r]))
    if (active.size === 0) continue // fully empty row — caller already skips these

    let best: { idx: number; sim: number } | null = null
    for (let c = 0; c < clusters.length; c++) {
      const sim = jaccard(active, clusters[c].rep)
      if (sim >= CLUSTER_SIMILARITY_THRESHOLD && (!best || sim > best.sim)) best = { idx: c, sim }
    }

    if (best) {
      clusters[best.idx].rowIndices.push(r)
      // Narrow the cluster's representative signature toward the intersection,
      // so it converges on the columns truly shared by all members.
      clusters[best.idx].rep = new Set([...clusters[best.idx].rep].filter(h => active.has(h)))
    } else {
      clusters.push({ rep: active, rowIndices: [r] })
    }
  }

  return clusters.map(c => {
    const signature = [...c.rep].sort()
    return { signature, signatureHash: hashSignature(signature), rowIndices: c.rowIndices }
  })
}

// ── 4) Per-cluster field resolution: score, pick best, or flag conflict ──

export type FieldCandidate = { header: string; colIndex: number; score: number; headerScore: number; contentScore: number }
export type FieldResolution = {
  field: StandardField
  resolvedHeader: string | null   // null if unresolved
  confidence: number
  candidates: FieldCandidate[]    // all candidates considered, sorted desc by score
  needsMapping: boolean           // true if ambiguous (close top-2) or missing & required
}

const CONFIDENCE_GAP_THRESHOLD = 0.18   // gap needed between #1 and #2 to auto-decide
const MIN_CONFIDENCE_TO_ACCEPT = 0.35    // below this, treat as "no real candidate"

const ALL_FIELDS: StandardField[] = [
  'full_name', 'phone', 'whatsapp', 'national_id', 'city', 'employer', 'monthly_income', 'email',
  'original_amount', 'current_balance', 'currency', 'due_date', 'status', 'priority', 'product_type',
  'account_number', 'reference_number', 'notes', 'collector_name', 'portfolio_name',
]

export function resolveClusterMapping(
  headers: string[],
  rows: string[][],
  cluster: RowCluster,
  opts: { companyColumnAliases?: Record<string, StandardField | string>; savedFieldMap?: Record<string, StandardField> } = {},
): { resolutions: Record<StandardField, FieldResolution>; fieldMap: Record<number, StandardField>; needsMapping: boolean } {
  const activeIdx = headers.map((h, i) => (cluster.signature.includes(h) ? i : -1)).filter(i => i !== -1)
  const sampleByCol: Record<number, string[]> = {}
  for (const i of activeIdx) sampleByCol[i] = cluster.rowIndices.map(r => rows[r][i] ?? '').filter(v => v != null)

  const resolutions = {} as Record<StandardField, FieldResolution>
  const fieldMap: Record<number, StandardField> = {}
  let anyNeedsMapping = false

  for (const field of ALL_FIELDS) {
    const candidates: FieldCandidate[] = []
    for (const i of activeIdx) {
      const header = headers[i]
      const hNorm = stripInvisible(norm(header))

      // Priority 1: a previously-confirmed template for this exact cluster.
      if (opts.savedFieldMap && opts.savedFieldMap[header] === field) {
        candidates.push({ header, colIndex: i, score: 1.0, headerScore: 1.0, contentScore: 1.0 })
        continue
      }
      // Priority 2: a known company profile's explicit column alias.
      if (opts.companyColumnAliases && opts.companyColumnAliases[hNorm] === field) {
        candidates.push({ header, colIndex: i, score: 0.95, headerScore: 0.95, contentScore: 0 })
        continue
      }

      const hScore = headerScore(header, field)

      // Cross-field exclusivity (general — not specific to any field name):
      // if this column's header confidently matches a DIFFERENT field (e.g.
      // its header clearly reads as "portfolio"/"product type"/"phone"),
      // that is strong negative evidence against it ALSO being THIS field —
      // a column is rarely two things at once. Skip it as a candidate here
      // unless ITS header score for the current field is just as strong.
      const bestOtherFieldScore = Math.max(
        0, ...ALL_FIELDS.filter(f => f !== field).map(f => headerScore(header, f)),
      )
      if (bestOtherFieldScore >= 0.6 && bestOtherFieldScore > hScore) continue

      // A reference/ID-style header (SADAD number, invoice number...) can
      // never win an amount field PURELY on content shape — only if its
      // header itself actually scored for this amount field.
      if ((field === 'original_amount' || field === 'current_balance') && hScore === 0 && looksLikeIdentifierHeader(header)) continue

      const cScore = contentScore(field, sampleByCol[i] ?? [])
      if (hScore === 0 && cScore === 0) continue
      // Header carries primary weight; content BREAKS TIES and catches cases
      // where the header is misleading (e.g. contains "العميل" but the data
      // is clearly a repeated status, not a unique name).
      const score = hScore * 0.65 + cScore * 0.35
      if (score > 0.05) candidates.push({ header, colIndex: i, score, headerScore: hScore, contentScore: cScore })
    }

    candidates.sort((a, b) => b.score - a.score)
    const top = candidates[0]
    const second = candidates[1]
    const gap = top ? top.score - (second?.score ?? 0) : 0
    const isRequired = REQUIRED_FIELDS.includes(field) || REQUIRED_AMOUNT_FIELDS.includes(field)

    let resolvedHeader: string | null = null
    let needsMapping = false

    if (!top || top.score < MIN_CONFIDENCE_TO_ACCEPT) {
      // Missing & REQUIRED → must ask. Missing & optional → just leave unset;
      // an optional field with no real candidate is normal, not an error.
      needsMapping = isRequired
    } else if (!second || gap >= CONFIDENCE_GAP_THRESHOLD) {
      resolvedHeader = top.header
      fieldMap[top.colIndex] = field
    } else if (isRequired) {
      // Genuine conflict on a REQUIRED field — never silently guess; this is
      // the only case that must block the cluster and ask a human.
      needsMapping = true
    }
    // Ambiguous conflict on an OPTIONAL field: deliberately left unresolved
    // (no guess, no block) rather than forcing every optional column to be
    // perfectly disambiguated before any row can import.

    resolutions[field] = { field, resolvedHeader, confidence: top?.score ?? 0, candidates, needsMapping }
    if (needsMapping) anyNeedsMapping = true
  }

  // The amount requirement is "at least one of" — relax if either resolved.
  if (resolutions.original_amount?.resolvedHeader || resolutions.current_balance?.resolvedHeader) {
    if (!resolutions.original_amount.resolvedHeader) resolutions.original_amount.needsMapping = false
    if (!resolutions.current_balance.resolvedHeader) resolutions.current_balance.needsMapping = false
    anyNeedsMapping = ALL_FIELDS.some(f => resolutions[f].needsMapping)
  }

  return { resolutions, fieldMap, needsMapping: anyNeedsMapping }
}

// ── 5) Top-level analysis: parse already done by caller; this orchestrates
//      clustering + per-cluster resolution into one diagnostic report. ──

export type ClusterReport = {
  clusterIndex: number
  signature: string[]
  signatureHash: string
  rowIndices: number[]      // 0-based indices into `rows`
  rowNumbers: number[]      // human-facing (rowIndex + 2, matching spreadsheet line numbers)
  label: string | null
  fieldMap: Record<number, StandardField>
  needsMapping: boolean
  unresolvedFields: StandardField[]
  resolutions: Record<StandardField, FieldResolution>
}

export function analyzeImportFile(
  headers: string[],
  rows: string[][],
  opts: {
    companyColumnAliases?: Record<string, StandardField | string>
    portfolioLabelForCluster?: (cluster: RowCluster) => string | null
    savedTemplates?: Record<string, Record<string, StandardField>> // signatureHash -> fieldMap (header->field)
  } = {},
): { clusters: ClusterReport[]; needsAnyMapping: boolean } {
  const clusters = clusterRowsByLayout(headers, rows)
  const reports: ClusterReport[] = clusters.map((cluster, idx) => {
    const saved = opts.savedTemplates?.[cluster.signatureHash]
    const { resolutions, fieldMap, needsMapping } = resolveClusterMapping(headers, rows, cluster, {
      companyColumnAliases: opts.companyColumnAliases,
      savedFieldMap: saved,
    })
    const unresolvedFields = ALL_FIELDS.filter(f => resolutions[f].needsMapping)
    return {
      clusterIndex: idx,
      signature: cluster.signature,
      signatureHash: cluster.signatureHash,
      rowIndices: cluster.rowIndices,
      rowNumbers: cluster.rowIndices.map(i => i + 2),
      label: opts.portfolioLabelForCluster?.(cluster) ?? null,
      fieldMap,
      needsMapping,
      unresolvedFields,
      resolutions,
    }
  })
  return { clusters: reports, needsAnyMapping: reports.some(r => r.needsMapping) }
}
