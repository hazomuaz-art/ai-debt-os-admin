// Diagnostic-only script: runs the REAL production parser (parseXLSX) and the
// REAL header-mapping logic from src/app/api/debts/import/route.ts against a
// real uploaded file, and prints exactly what the import route would compute
// for each row — including which rows it would reject as "missing customer
// name" and why. Nothing here is written to the DB; read-only diagnosis.
import { readFileSync } from 'fs'
import { parseXLSX, isXLSX } from '../src/lib/excel-parser'

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: tsx scripts/diagnose-import.ts <path-to-file>')
  process.exit(1)
}

const buf = readFileSync(filePath)
const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)

console.log('=== File magic bytes ===')
console.log('isXLSX():', isXLSX(arrayBuf))

const parsed = parseXLSX(arrayBuf)
console.log('\n=== Sheet name ===', parsed.name)
console.log('\n=== Headers (as parsed, lowercased+trimmed by parseXLSX) ===')
parsed.headers.forEach((h, i) => console.log(`  [${i}] "${h}"`))
console.log('\n=== Row count ===', parsed.rows.length)

// ── EXACT COLUMN_MAP + getMappedColumn copied from src/app/api/debts/import/route.ts ──
const COLUMN_MAP: Record<string, string> = {
  'customer name': 'full_name', 'full name': 'full_name', 'name': 'full_name',
  'client name': 'full_name', 'client': 'full_name',
  'phone': 'phone', 'mobile': 'phone', 'telephone': 'phone',
  'whatsapp': 'whatsapp', 'whatsapp number': 'whatsapp',
  'national id': 'national_id', 'id number': 'national_id', 'iqama': 'national_id',
  'national id number': 'national_id', 'id': 'national_id',
  'city': 'city', 'region': 'city',
  'employer': 'employer', 'company': 'employer', 'work': 'employer',
  'monthly income': 'monthly_income', 'income': 'monthly_income', 'salary': 'monthly_income',
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

function getMappedColumn(header: string): string | null {
  const h = header.toLowerCase().replace(/\s+/g, ' ').trim()
  const clean = h.replace(/[​-‍﻿]/g, '')
  if (COLUMN_MAP[clean]) return COLUMN_MAP[clean]
  if (clean.includes('اسم') && (clean.includes('عميل') || clean.includes('مستفيد'))) return 'full_name'
  if (clean.includes('العميل')) return 'full_name'
  if (clean.includes('هوية') || clean.includes('إقامة') || clean.includes('اقامة')) return 'national_id'
  if (clean.includes('مبلغ') || clean.includes('مديونية') || clean.includes('رصيد') || clean.includes('مطالبة')) return 'current_balance'
  if (clean.includes('تواصل') || clean.includes('جوال') || clean.includes('هاتف') || clean.includes('موبايل')) return 'phone'
  if (clean.includes('حساب') && !clean.includes('نوع')) return 'account_number'
  if (clean.includes('عقد') || clean.includes('مرجع')) return 'reference_number'
  if (clean.includes('محفظة') || clean.includes('مشروع')) return 'portfolio_name'
  if (clean.includes('حالة') || clean.includes('حاله')) return 'status'
  if (clean.includes('منتج') || clean.includes('خدمة')) return 'product_type'
  if (clean.includes('ملاحظ') || clean.includes('تعليق')) return 'notes'
  if (clean.includes('موعد') || clean.includes('استحقاق') || clean.includes('سداد')) return 'due_date'
  if (clean.includes('راتب') || clean.includes('دخل')) return 'monthly_income'
  if (clean.includes('شركة') || clean.includes('عمل') || clean.includes('جهة')) return 'employer'
  if (clean.includes('مستخدم') || clean.includes('محصل') || clean.includes('مسؤول')) return 'collector_name'
  return null
}

const headers = parsed.headers
const rows = parsed.rows

const fieldMap: Record<number, string> = {}
const unmappedHeaderIdx: number[] = []
for (let i = 0; i < headers.length; i++) {
  const h = headers[i].toLowerCase().trim()
  const mapped = getMappedColumn(headers[i])
  if (mapped) fieldMap[i] = mapped
  else unmappedHeaderIdx.push(i)
}

console.log('\n=== fieldMap (colIndex -> dbField) ===')
for (const [idx, field] of Object.entries(fieldMap)) {
  console.log(`  col[${idx}] "${headers[Number(idx)]}" -> ${field}`)
}
console.log('\n=== UNMAPPED headers (ignored, go to metadata.extra) ===')
unmappedHeaderIdx.forEach(i => console.log(`  col[${i}] "${headers[i]}"`))

const fullNameColIdxs = Object.entries(fieldMap).filter(([, f]) => f === 'full_name').map(([i]) => Number(i))
console.log('\n=== Column index(es) mapped to full_name ===', fullNameColIdxs)

console.log('\n=== Row-by-row: raw cells + computed full_name ===')
let imported = 0, missingName = 0
for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
  const row = rows[rowIdx]
  if (!row || row.every(cell => !cell?.trim())) { console.log(`Row ${rowIdx + 2}: EMPTY ROW (skipped silently)`); continue }

  const f: Record<string, string> = {}
  for (const [colIdxStr, fieldName] of Object.entries(fieldMap)) {
    const val = row[parseInt(colIdxStr)]?.trim()
    if (val) f[fieldName] = val
  }

  const rawNameCells = fullNameColIdxs.map(i => JSON.stringify(row[i]))
  console.log(`Row ${rowIdx + 2}: raw row = ${JSON.stringify(row)}`)
  console.log(`         full_name col raw value(s) = ${rawNameCells.join(', ')}`)
  console.log(`         f.full_name computed = ${JSON.stringify(f.full_name)}`)

  if (!f.full_name) {
    missingName++
    console.log(`         >>> REJECTED: missing customer name`)
  } else {
    imported++
  }
}

console.log('\n=== SUMMARY ===')
console.log('total data rows parsed:', rows.length)
console.log('would import:', imported)
console.log('would reject (missing customer name):', missingName)
