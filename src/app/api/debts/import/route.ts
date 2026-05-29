import { createLogger } from '@/lib/logger'
const logger = createLogger('api/debts/import')

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateReferenceNumber } from '@/lib/utils'
import { z } from 'zod'
import { mapImportedStatus, calculateImportRisk } from '@/lib/import-mapping'

// Expected CSV columns (case-insensitive header matching)
const COLUMN_MAP: Record<string, string> = {
  'customer name': 'full_name',
  'full name': 'full_name',
  'name': 'full_name',
  'phone': 'phone',
  'mobile': 'phone',
  'whatsapp': 'whatsapp',
  'national id': 'national_id',
  'id number': 'national_id',
  'city': 'city',
  'employer': 'employer',
  'monthly income': 'monthly_income',
  'income': 'monthly_income',
  'amount': 'original_amount',
  'original amount': 'original_amount',
  'debt amount': 'original_amount',
  'balance': 'current_balance',
  'current balance': 'current_balance',
  'outstanding': 'current_balance',
  'currency': 'currency',
  'due date': 'due_date',
  'status': 'status',
  'priority': 'priority',
  'product': 'product_type',
  'product type': 'product_type',
  'account number': 'account_number',
  'account': 'account_number',
  'notes': 'notes',
  'description': 'description',
  'company': 'creditor_name',
  'project': 'product_type',
  'claim number': 'claim_number',
  'claim reason': 'claim_reason',
  'customer status': 'status',
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return { headers: [], rows: [] }

  function parseLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim())
  const rows = lines.slice(1).map(parseLine)
  return { headers, rows }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })
    if (!['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    if (!file.name.endsWith('.csv')) return NextResponse.json({ error: 'Must be a .csv file' }, { status: 400 })
    if (file.size > 5 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 5MB)' }, { status: 400 })

    const text = await file.text()
    const { headers, rows } = parseCSV(text)

    if (headers.length === 0) return NextResponse.json({ error: 'Empty or invalid CSV' }, { status: 400 })

    // Map CSV headers to field names
    const fieldMap: Record<number, string> = {}
    for (let i = 0; i < headers.length; i++) {
      const mapped = COLUMN_MAP[headers[i]]
      if (mapped) fieldMap[i] = mapped
    }

    if (!Object.values(fieldMap).includes('full_name')) {
      return NextResponse.json({ error: 'CSV must have a "name" or "customer name" column' }, { status: 400 })
    }
    if (!Object.values(fieldMap).includes('original_amount')) {
      return NextResponse.json({ error: 'CSV must have an "amount" or "original amount" column' }, { status: 400 })
    }

    const results = { imported: 0, skipped: 0, errors: [] as string[] }

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]
      if (row.every(cell => !cell)) continue // skip blank rows

      const fields: Record<string, any> = {}
      for (const [colIdx, fieldName] of Object.entries(fieldMap)) {
        const val = row[parseInt(colIdx)]?.trim()
        if (val) fields[fieldName] = val
      }

      if (!fields.full_name) {
        results.errors.push(`Row ${rowIdx + 2}: missing customer name`)
        results.skipped++
        continue
      }

      const amount = parseFloat(fields.original_amount)
      if (isNaN(amount) || amount <= 0) {
        results.errors.push(`Row ${rowIdx + 2}: invalid amount "${fields.original_amount}"`)
        results.skipped++
        continue
      }

      try {
        // Upsert customer by national_id or phone, else create
        let customerId: string

        let existingCustomer = null
        if (fields.national_id) {
          const { data } = await supabase
            .from('customers')
            .select('id')
            .eq('company_id', profile.company_id)
            .eq('national_id', fields.national_id)
            .maybeSingle()
          existingCustomer = data
        }
        if (!existingCustomer && fields.phone) {
          const { data } = await supabase
            .from('customers')
            .select('id')
            .eq('company_id', profile.company_id)
            .eq('phone', fields.phone)
            .maybeSingle()
          existingCustomer = data
        }

        if (existingCustomer) {
          customerId = existingCustomer.id
          // Update customer data
          await supabase
            .from('customers')
            .update({
              full_name: fields.full_name,
              ...(fields.phone && { phone: fields.phone }),
              ...(fields.whatsapp && { whatsapp: fields.whatsapp }),
              ...(fields.city && { city: fields.city }),
              ...(fields.employer && { employer: fields.employer }),
              ...(fields.monthly_income && { monthly_income: parseFloat(fields.monthly_income) }),
            })
            .eq('id', customerId)
        } else {
          const { data: newCustomer, error: custErr } = await supabase
            .from('customers')
            .insert({
              company_id: profile.company_id,
              created_by: user.id,
              full_name: fields.full_name,
              phone: fields.phone || null,
              whatsapp: fields.whatsapp || null,
              national_id: fields.national_id || null,
              city: fields.city || null,
              employer: fields.employer || null,
              monthly_income: fields.monthly_income ? parseFloat(fields.monthly_income) : null,
            })
            .select('id')
            .single()

          if (custErr || !newCustomer) {
            results.errors.push(`Row ${rowIdx + 2}: failed to create customer â€” ${custErr?.message}`)
            results.skipped++
            continue
          }
          customerId = newCustomer.id
        }

        // Validate status/priority
        const validPriorities = ['low', 'medium', 'high', 'critical']
        const status = mapImportedStatus(fields.status)
        const priority = validPriorities.includes(fields.priority) ? fields.priority : calculateImportRisk(fields.status, amount)

        // Parse due_date
        let dueDate: string | null = null
        if (fields.due_date) {
          const d = new Date(fields.due_date)
          if (!isNaN(d.getTime())) dueDate = d.toISOString().split('T')[0]
        }

        const currentBalance = fields.current_balance ? parseFloat(fields.current_balance) : (status === 'settled' ? 0 : amount)

        const { error: debtErr } = await supabase
          .from('debts')
          .insert({
            company_id: profile.company_id,
            customer_id: customerId,
            created_by: user.id,
            reference_number: generateReferenceNumber(),
            original_amount: amount,
            current_balance: currentBalance,
            currency: fields.currency || 'SAR',
            status,
            priority,
            due_date: dueDate,
            product_type: fields.product_type || fields.creditor_name || null,
            account_number: fields.account_number || null,
            notes: fields.notes || fields.description || fields.claim_reason || fields.claim_number || null,
          })

        if (debtErr) {
          results.errors.push(`Row ${rowIdx + 2}: failed to create debt â€” ${debtErr.message}`)
          results.skipped++
        } else {
          results.imported++
        }
      } catch (e: any) {
        results.errors.push(`Row ${rowIdx + 2}: ${e.message}`)
        results.skipped++
      }
    }

    return NextResponse.json({
      data: results,
      message: `Imported ${results.imported} debts, skipped ${results.skipped}`,
    })
  } catch (error) {
    logger.error('CSV import failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    )
  }
}

