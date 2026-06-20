import { createLogger } from '@/lib/logger'
const logger = createLogger('api/debts/import')

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateReferenceNumber } from '@/lib/utils'
import { parseXLSX, isXLSX } from '@/lib/excel-parser'
import { processEventBatch, type PipelineEvent } from '@/lib/automation-pipeline'
import { findCompanyProfile, resolveCompanyProfile, type CompanyImportProfile } from '@/lib/company-import-profiles'
import { buildPortfolioPayload, upsertPortfolioCustomerData } from '@/lib/portfolio-customer-data'

// ── Column mapping (English + Arabic) ──────────────────────────────────────
// Handles: UTF-8, Windows-1256, and common Arabic column names from
// Saudi collection systems (Debit Collect, Tamiuzz, etc.)

const COLUMN_MAP: Record<string, string> = {
  // English — customer fields
  'customer name': 'full_name', 'full name': 'full_name', 'name': 'full_name',
  'client name': 'full_name', 'client': 'full_name',
  'phone': 'phone', 'mobile': 'phone', 'telephone': 'phone',
  'whatsapp': 'whatsapp', 'whatsapp number': 'whatsapp',
  'national id': 'national_id', 'id number': 'national_id', 'iqama': 'national_id',
  'national id number': 'national_id', 'id': 'national_id',
  'city': 'city', 'region': 'city',
  'employer': 'employer', 'company': 'employer', 'work': 'employer',
  'monthly income': 'monthly_income', 'income': 'monthly_income', 'salary': 'monthly_income',
  // English — debt fields
  'amount': 'original_amount', 'original amount': 'original_amount',
  'debt amount': 'original_amount', 'loan amount': 'original_amount',
  'total amount': 'original_amount', 'principal': 'original_amount',
  'balance': 'current_balance', 'current balance': 'current_balance',
  'outstanding': 'current_balance', 'remaining': 'current_balance',
  'outstanding balance': 'current_balance', 'remaining balance': 'current_balance',
  'currency': 'currency',
  'due date': 'due_date', 'expiry date': 'due_date', 'maturity date': 'due_date',
  'status': 'status', 'debt status': 'status',
  'priority': 'priority',
  'product': 'product_type', 'product type': 'product_type', 'service': 'product_type',
  'account number': 'account_number', 'account': 'account_number', 'contract': 'account_number',
  'reference': 'reference_number', 'ref': 'reference_number', 'case number': 'reference_number',
  'notes': 'notes', 'description': 'notes', 'remarks': 'notes', 'comment': 'notes',
  'collector': 'collector_name', 'assigned to': 'collector_name',
  'portfolio': 'portfolio_name',
  // Arabic — customer fields
  'اسم العميل': 'full_name', 'الاسم': 'full_name', 'الاسم الكامل': 'full_name',
  'الاسم بالكامل': 'full_name', 'اسم': 'full_name', 'العميل': 'full_name',
  'الجوال': 'phone', 'رقم الجوال': 'phone', 'الهاتف': 'phone', 'رقم الهاتف': 'phone',
  'الموبايل': 'phone', 'رقم الموبايل': 'phone',
  'واتساب': 'whatsapp', 'رقم الواتساب': 'whatsapp', 'واتس': 'whatsapp',
  'الهوية': 'national_id', 'رقم الهوية': 'national_id', 'الهوية الوطنية': 'national_id',
  'رقم الهوية الوطنية': 'national_id', 'هوية': 'national_id', 'الإقامة': 'national_id',
  'المدينة': 'city', 'المنطقة': 'city', 'المحافظة': 'city',
  'جهة العمل': 'employer', 'صاحب العمل': 'employer', 'الجهة': 'employer', 'العمل': 'employer',
  'الراتب': 'monthly_income', 'الدخل': 'monthly_income', 'الدخل الشهري': 'monthly_income',
  'الراتب الشهري': 'monthly_income',
  // Arabic — debt fields
  'المبلغ': 'original_amount', 'المبلغ الأصلي': 'original_amount', 'قيمة الدين': 'original_amount',
  'مبلغ الدين': 'original_amount', 'إجمالي الدين': 'original_amount', 'الدين': 'original_amount',
  'الرصيد': 'current_balance', 'الرصيد المتبقي': 'current_balance', 'المبلغ المتبقي': 'current_balance',
  'المتبقي': 'current_balance', 'الرصيد الحالي': 'current_balance',
  'العملة': 'currency',
  'تاريخ الاستحقاق': 'due_date', 'تاريخ السداد': 'due_date', 'الاستحقاق': 'due_date',
  'الحالة': 'status', 'حالة الدين': 'status', 'حالة القضية': 'status',
  'الأولوية': 'priority',
  'المنتج': 'product_type', 'نوع المنتج': 'product_type', 'الخدمة': 'product_type',
  'رقم الحساب': 'account_number', 'رقم العقد': 'account_number', 'حساب': 'account_number',
  'رقم القضية': 'reference_number', 'المرجع': 'reference_number', 'رقم المرجع': 'reference_number',
  'ملاحظات': 'notes', 'ملاحظة': 'notes', 'التعليق': 'notes', 'وصف': 'notes',
  'المحصل': 'collector_name', 'اسم المحصل': 'collector_name',
  'المحفظة': 'portfolio_name', 'المشروع': 'portfolio_name', 'الجهة الممولة': 'portfolio_name',
  'email': 'email', 'e-mail': 'email', 'البريد الالكتروني': 'email', 'الايميل': 'email', 'الإيميل': 'email',
  // Extra aliases
  'customer': 'full_name', 'debtor': 'full_name', 'debtor name': 'full_name',
  'client full name': 'full_name',
  'debt': 'original_amount', 'loan': 'original_amount', 'principal amount': 'original_amount',
  'total debt': 'original_amount', 'claim amount': 'original_amount',
  'مبلغ': 'original_amount', 'القيمة': 'original_amount',
  'remaining amount': 'current_balance', 'remaining debt': 'current_balance',
  'unpaid': 'current_balance', 'unpaid amount': 'current_balance',
  'رصيد': 'current_balance', 'المبلغ الباقي': 'current_balance',
  'case status': 'status', 'collection status': 'status', 'loan status': 'status',
  'contract number': 'account_number', 'case ref': 'reference_number',
}

// Arabic status mapping
const STATUS_MAP: Record<string, string> = {
  'active': 'active', 'pending': 'pending', 'in_negotiation': 'in_negotiation',
  'payment_plan': 'payment_plan', 'settled': 'settled', 'legal': 'legal', 'written_off': 'written_off',
  'نشط': 'active', 'فعال': 'active', 'جديد': 'active',
  'معلق': 'pending', 'قيد المعالجة': 'pending',
  'قيد التفاوض': 'in_negotiation', 'تفاوض': 'in_negotiation',
  'خطة سداد': 'payment_plan', 'تقسيط': 'payment_plan',
  'مسدد': 'settled', 'مدفوع': 'settled', 'منتهي': 'settled',
  'قانوني': 'legal', 'محكمة': 'legal',
  'مشطوب': 'written_off', 'معدوم': 'written_off',
}

function mapStatus(raw: string | undefined): string {
  if (!raw) return 'active'
  const s = raw.toLowerCase().trim()
  return STATUS_MAP[s] ?? STATUS_MAP[raw.trim()] ?? 'active'
}

function getMappedColumn(header: string): string | null {
  const h = header.toLowerCase().replace(/\s+/g, ' ').trim();
  // Clean up hidden characters, zero width spaces, BOM, etc.
  const clean = h.replace(/[\u200B-\u200D\uFEFF]/g, '');

  if (COLUMN_MAP[clean]) return COLUMN_MAP[clean];
  
  // Fuzzy match keywords to completely eliminate strict header errors
  if (clean.includes('اسم') && (clean.includes('عميل') || clean.includes('مستفيد'))) return 'full_name';
  if (clean.includes('العميل')) return 'full_name';
  if (clean.includes('هوية') || clean.includes('إقامة') || clean.includes('اقامة')) return 'national_id';
  if (clean.includes('مبلغ') || clean.includes('مديونية') || clean.includes('رصيد') || clean.includes('مطالبة')) return 'current_balance';
  if (clean.includes('تواصل') || clean.includes('جوال') || clean.includes('هاتف') || clean.includes('موبايل')) return 'phone';
  if (clean.includes('حساب') && !clean.includes('نوع')) return 'account_number';
  if (clean.includes('عقد') || clean.includes('مرجع')) return 'reference_number';
  if (clean.includes('محفظة') || clean.includes('مشروع')) return 'portfolio_name';
  if (clean.includes('حالة') || clean.includes('حاله')) return 'status';
  if (clean.includes('منتج') || clean.includes('خدمة')) return 'product_type';
  if (clean.includes('ملاحظ') || clean.includes('تعليق')) return 'notes';
  if (clean.includes('موعد') || clean.includes('استحقاق') || clean.includes('سداد')) return 'due_date';
  if (clean.includes('راتب') || clean.includes('دخل')) return 'monthly_income';
  if (clean.includes('شركة') || clean.includes('عمل') || clean.includes('جهة')) return 'employer';
  if (clean.includes('مستخدم') || clean.includes('محصل') || clean.includes('مسؤول')) return 'collector_name';
  
  return null;
}

// ── Fix encoding issues (Windows-1256 / CP1256 for Arabic) ─────────────────

function fixEncoding(text: string): string {
  // If text looks like it's already valid UTF-8 with Arabic, return as-is
  if (/[\u0600-\u06FF]/.test(text)) return text
  // Try to fix common Windows-1256 mojibake by re-interpreting chars
  // Common issue: Arabic text stored in CP1256 read as Latin-1
  // We can't truly fix this without knowing the original encoding,
  // but we can clean up obvious garbage characters
  return text.replace(/[\x80-\x9F]/g, '').replace(/\uFFFD/g, '').trim()
}

// ── Parse CSV with proper encoding detection ────────────────────────────────

function parseCSVBuffer(buf: ArrayBuffer): { headers: string[]; rows: string[][] } {
  // Detect BOM and encoding
  const bytes = new Uint8Array(buf)
  let text: string

  // UTF-8 BOM
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    text = new TextDecoder('utf-8').decode(buf.slice(3))
  }
  // UTF-16 LE BOM
  else if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    text = new TextDecoder('utf-16le').decode(buf.slice(2))
  }
  // UTF-16 BE BOM
  else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    text = new TextDecoder('utf-16be').decode(buf.slice(2))
  }
  // Try UTF-8, fall back to Windows-1256 for Arabic files
  else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      try {
        text = new TextDecoder('windows-1256').decode(buf)
      } catch {
        text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
      }
    }
  }

  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  
  // Clean up null bytes if it was UTF-16 decoded as UTF-8
  text = text.replace(/\0/g, '')

  const lines = text.trim().split('\n')
  if (lines.length === 0 || text.trim() === '') {
    throw new Error('الملف فارغ تماماً (Empty File).')
  }
  if (lines.length === 1) {
    throw new Error('الملف يحتوي على صف العناوين فقط ولا توجد بيانات عملاء.')
  }

  // Detect delimiter
  const firstLine = lines[0]
  const commaCount = (firstLine.match(/,/g) || []).length
  const semiCount = (firstLine.match(/;/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length
  
  let delimiter = ','
  if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t'
  else if (semiCount > commaCount) delimiter = ';'

  function parseLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === delimiter && !inQuotes) {
        result.push(fixEncoding(current.trim()))
        current = ''
      } else {
        current += ch
      }
    }
    result.push(fixEncoding(current.trim()))
    return result
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim())
  const rows    = lines.slice(1).filter(l => l.trim()).map(parseLine)
  return { headers, rows }
}

// ── Portfolio lookup cache ─────────────────────────────────────────────────

async function lookupPortfolio(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  portfolioName: string | undefined,
  _portfolioCache: Map<string, string>,
): Promise<string | null> {
  if (!portfolioName) return null
  const key = portfolioName.toLowerCase().trim()
  if (_portfolioCache.has(key)) return _portfolioCache.get(key)!

  const { data } = await supabase
    .from('portfolios')
    .select('id')
    .eq('company_id', companyId)
    .ilike('name', portfolioName)
    .maybeSingle()

  if (data) {
    _portfolioCache.set(key, (data as { id: string }).id)
    return (data as { id: string }).id
  }
  return null
}

// Ensures a portfolio exists for a known company profile, seeding it with
// the company-specific contact-outcome categories so the UI can show the
// right dropdown instead of a generic one. Idempotent — safe to call once
// per import.
async function ensureCompanyPortfolio(
  supabase: ReturnType<typeof createClient>,
  companyId: string,
  profile: CompanyImportProfile,
): Promise<string> {
  const { data: existing } = await supabase
    .from('portfolios').select('id, metadata')
    .eq('company_id', companyId).ilike('name', profile.nameAr)
    .maybeSingle()

  if (existing) {
    const id = (existing as { id: string }).id
    const meta = (existing as { metadata?: Record<string, unknown> }).metadata ?? {}
    if (!meta.outcome_categories) {
      await supabase.from('portfolios').update({
        metadata: { ...meta, outcome_categories: profile.outcomeCategories, company_key: profile.key },
      }).eq('id', id)
    }
    return id
  }

  const { data: created, error } = await supabase.from('portfolios').insert({
    company_id: companyId,
    name:       profile.nameAr,
    name_ar:    profile.nameAr,
    category:   profile.category,
    source_system: 'manual',
    metadata:   { outcome_categories: profile.outcomeCategories, company_key: profile.key, aliases: profile.aliases },
  }).select('id').single()

  if (error || !created) throw new Error(`Portfolio create failed: ${error?.message}`)
  return (created as { id: string }).id
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles').select('company_id, role').eq('id', user.id).single()

    if (!profile?.company_id)
      return NextResponse.json({ error: 'No company' }, { status: 400 })
    if (!['admin', 'manager'].includes(profile.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file)
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    // Optional: caller picked a known company profile (telecom/utility/
    // insurance/... import templates) — forces every row into that
    // company's portfolio and applies its company-specific column aliases.
    const companyKey = (formData.get('company_key') as string | null)?.trim() || null
    const companyProfile = companyKey ? findCompanyProfile(companyKey) : null
    const forcedPortfolioId = companyProfile ? await ensureCompanyPortfolio(supabase, profile.company_id, companyProfile) : null

    const allowed = ['.csv', '.xlsx', '.xls']
    const ext = '.' + file.name.split('.').pop()!.toLowerCase()
    if (!allowed.includes(ext))
      return NextResponse.json({ error: 'Must be a .csv or .xlsx file' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024)
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })

    // Parse file
    const buf = await file.arrayBuffer()
    let headers: string[]
    let rows:    string[][]

    if (ext === '.xlsx' || ext === '.xls' || isXLSX(buf)) {
      try {
        const parsed = parseXLSX(buf)
        headers = parsed.headers
        rows    = parsed.rows
        logger.info(`Parsed XLSX: ${rows.length} rows, sheet: ${parsed.name}`)
      } catch (xlsxErr) {
        return NextResponse.json({
          error: `Failed to parse XLSX: ${xlsxErr instanceof Error ? xlsxErr.message : 'Unknown error'}`,
        }, { status: 400 })
      }
    } else {
      try {
        const parsed = parseCSVBuffer(buf)
        headers = parsed.headers
        rows    = parsed.rows
      } catch (csvErr) {
        return NextResponse.json({
          error: csvErr instanceof Error ? csvErr.message : 'Invalid CSV file format'
        }, { status: 400 })
      }
    }

    if (!headers || headers.length === 0)
      return NextResponse.json({ error: 'لم يتم العثور على أعمدة في الملف' }, { status: 400 })

    // Map headers to field names — company-specific aliases first (if a
    // known profile was picked), then the generic fuzzy matcher. Headers
    // that match neither are kept (not dropped) so their data still
    // reaches debts.metadata.extra further down.
    const fieldMap: Record<number, string> = {}
    const unmappedHeaderIdx: number[] = []
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i].toLowerCase().trim()
      const mapped = companyProfile?.columnAliases?.[h] ?? getMappedColumn(headers[i])
      if (mapped) fieldMap[i] = mapped
      else unmappedHeaderIdx.push(i)
    }

    // Validate required columns
    const fields = Object.values(fieldMap)
    if (!fields.includes('full_name'))
      return NextResponse.json({ error: `العمود المطلوب "اسم العميل" مفقود. الأعمدة التي تم العثور عليها: ${headers.join(' | ')}` }, { status: 400 })
    if (!fields.includes('original_amount') && !fields.includes('current_balance'))
      return NextResponse.json({ error: `العمود المطلوب "المبلغ" مفقود. الأعمدة التي تم العثور عليها: ${headers.join(' | ')}` }, { status: 400 })

    const portfolioCache = new Map<string, string>()
    const results = { imported: 0, skipped: 0, errors: [] as string[] }
    const pipelineEvents: PipelineEvent[] = []

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]
      if (!row || row.every(cell => !cell?.trim())) continue

      const f: Record<string, string> = {}
      for (const [colIdxStr, fieldName] of Object.entries(fieldMap)) {
        const val = row[parseInt(colIdxStr)]?.trim()
        if (val) f[fieldName] = val
      }

      // Preserve company-specific / unrecognised columns instead of
      // dropping them — e.g. CATEGORY, MNP, SADAD_NUMBER for Mobily.
      const extra: Record<string, string> = {}
      for (const idx of unmappedHeaderIdx) {
        const val = row[idx]?.trim()
        if (val) extra[headers[idx]] = val
      }

      // Full raw header→value map (every column, mapped or not) — used to
      // populate the portfolio-specific customer_data_<table>, since some
      // of those columns (e.g. "نوع الهوية") also map to a standard field.
      const rawByHeader: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        const val = row[i]?.trim()
        if (val) rawByHeader[headers[i].toLowerCase().trim()] = val
      }

      // Resolve which known portfolio this row belongs to — a forced
      // company profile (picked at upload time) always wins; otherwise
      // sort each row by its own "portfolio"/"محفظة" column, so a single
      // sheet containing multiple portfolios is routed correctly.
      const rowProfile = companyProfile ?? (f.portfolio_name ? resolveCompanyProfile(f.portfolio_name) : null)

      if (!f.full_name) {
        results.errors.push(`Row ${rowIdx + 2}: missing customer name`)
        results.skipped++
        continue
      }

      const rawAmount = f.original_amount ?? f.current_balance ?? '0'
      const amount = parseFloat(String(rawAmount).replace(/[,،، ]/g, '')) || 0
      if (amount <= 0) {
        results.errors.push(`Row ${rowIdx + 2}: invalid amount "${rawAmount}"`)
        results.skipped++
        continue
      }

      try {
        // Upsert customer
        let customerId: string

        let existing = null
        if (f.national_id) {
          const { data } = await supabase.from('customers').select('id')
            .eq('company_id', profile.company_id).eq('national_id', f.national_id).maybeSingle()
          existing = data
        }
        if (!existing && f.phone) {
          const cleanPhone = f.phone.replace(/[^\d+]/g, '')
          const { data } = await supabase.from('customers').select('id')
            .eq('company_id', profile.company_id).eq('phone', cleanPhone).maybeSingle()
          existing = data
        }

        if (existing) {
          customerId = (existing as { id: string }).id
          await supabase.from('customers').update({
            full_name:      f.full_name,
            ...(f.phone         && { phone:          f.phone.replace(/[^\d+]/g, '') }),
            ...(f.whatsapp      && { whatsapp:        f.whatsapp.replace(/[^\d+]/g, '') }),
            ...(f.city          && { city:            f.city }),
            ...(f.employer      && { employer:        f.employer }),
            ...(f.email         && { email:           f.email }),
            ...(f.monthly_income && { monthly_income: parseFloat(f.monthly_income.replace(/[,، ]/g, '')) }),
          }).eq('id', customerId)
        } else {
          const { data: newCust, error: custErr } = await supabase.from('customers').insert({
            company_id:     profile.company_id,
            created_by:     user.id,
            full_name:      f.full_name,
            phone:          f.phone?.replace(/[^\d+]/g, '') || null,
            whatsapp:       f.whatsapp?.replace(/[^\d+]/g, '') || null,
            national_id:    f.national_id || null,
            city:           f.city || null,
            employer:       f.employer || null,
            email:          f.email || null,
            monthly_income: f.monthly_income ? parseFloat(f.monthly_income.replace(/[,، ]/g, '')) : null,
          }).select('id').single()

          if (custErr || !newCust)
            throw new Error(`Customer create failed: ${custErr?.message}`)
          customerId = (newCust as { id: string }).id
        }

        // Route portfolio-specific columns into customer_data_<table> for
        // the row's resolved portfolio (Mobily, STC, التعاونية, ...).
        if (rowProfile) {
          const built = buildPortfolioPayload(rowProfile.key, rawByHeader)
          if (built) {
            await upsertPortfolioCustomerData(supabase, {
              companyKey:  rowProfile.key,
              companyId:   profile.company_id,
              customerId,
              portfolioId: forcedPortfolioId
                ?? await ensureCompanyPortfolio(supabase, profile.company_id, rowProfile),
              payload: built.payload,
            })
          }
        }

        // Parse dates
        let dueDate: string | null = null
        if (f.due_date) {
          // Handle DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, Arabic formats
          const raw = f.due_date.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
          const parts = raw.split(/[\/\-\.]/)
          let d: Date | null = null
          if (parts.length === 3) {
            // Try YYYY-MM-DD first
            if (parts[0].length === 4)  d = new Date(`${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`)
            // DD/MM/YYYY
            else if (parseInt(parts[0]) > 12) d = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`)
            // MM/DD/YYYY
            else d = new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`)
          }
          if (d && !isNaN(d.getTime())) dueDate = d.toISOString().split('T')[0]
        }

        // Resolve portfolio — a forced company profile always wins; else
        // a row-detected known profile gets its dedicated portfolio;
        // otherwise fall back to plain name lookup against `portfolios`.
        const portfolioId = forcedPortfolioId
          ?? (rowProfile ? await ensureCompanyPortfolio(supabase, profile.company_id, rowProfile) : null)
          ?? await lookupPortfolio(supabase, profile.company_id, f.portfolio_name, portfolioCache)

        const status   = mapStatus(f.status)
        const priority = ['low','medium','high','critical'].includes(f.priority?.toLowerCase() ?? '')
          ? f.priority!.toLowerCase()
          : 'medium'
        const currentBalance = f.current_balance
          ? parseFloat(f.current_balance.replace(/[,، ]/g, ''))
          : amount

        const { data: newDebt, error: debtErr } = await supabase.from('debts').insert({
          company_id:       profile.company_id,
          customer_id:      customerId,
          created_by:       user.id,
          reference_number: f.reference_number ?? generateReferenceNumber(),
          original_amount:  amount,
          current_balance:  currentBalance,
          currency:         f.currency || 'SAR',
          status,
          priority,
          due_date:         dueDate,
          product_type:     f.product_type  || null,
          account_number:   f.account_number || null,
          notes:            f.notes         || null,
          collector_name:   f.collector_name || null,
          portfolio_id:     portfolioId,
          ...(Object.keys(extra).length > 0 && { metadata: { extra } }),
        }).select('id').single()

        if (debtErr) throw new Error(`Debt create failed: ${debtErr.message}`)

        results.imported++
        const debtId = (newDebt as { id: string }).id

        // Queue pipeline event for each imported record
        pipelineEvents.push({
          source:       'csv_import',
          company_id:   profile.company_id,
          actor_id:     user.id,
          _customer_id: customerId,
          _debt_id:     debtId,
          data: { notes: f.notes, status, source: ext },
        })
      } catch (e) {
        results.errors.push(`Row ${rowIdx + 2}: ${e instanceof Error ? e.message : String(e)}`)
        results.skipped++
      }
    }

    // Run automation pipeline SYNCHRONOUSLY before returning response.
    // Fire-and-forget is NOT used because Vercel terminates the process
    // immediately after the HTTP response is sent.
    let pipelineResult = { succeeded: 0, failed: 0, skipped: 0, total_alerts: 0, total_actions: 0 }
    if (pipelineEvents.length > 0) {
      try {
        pipelineResult = await processEventBatch(pipelineEvents, 4)
        logger.info('Pipeline complete', { imported: results.imported, pipeline: pipelineResult })
      } catch (pipelineErr) {
        logger.warn('Pipeline batch error', pipelineErr)
      }
    }

    return NextResponse.json({
      data:    results,
      pipeline: pipelineResult,
      message: `Imported ${results.imported} records. Pipeline: ${pipelineResult.succeeded} processed, ${pipelineResult.total_alerts} alerts, ${pipelineResult.total_actions} actions.`,
    })
  } catch (error) {
    logger.error('Import failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    )
  }
}
