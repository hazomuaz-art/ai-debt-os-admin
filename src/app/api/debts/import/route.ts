import { createLogger } from '@/lib/logger'
const logger = createLogger('api/debts/import')

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateReferenceNumber } from '@/lib/utils'
import { parseXLSX, isXLSX } from '@/lib/excel-parser'
import { parseCSVBuffer } from '@/lib/csv-parser'
import { processEventBatch, type PipelineEvent } from '@/lib/automation-pipeline'
import { findCompanyProfile, resolveCompanyProfile, type CompanyImportProfile } from '@/lib/company-import-profiles'
import { buildPortfolioPayload, upsertPortfolioCustomerData } from '@/lib/portfolio-customer-data'
import { clusterRowsByLayout, resolveClusterMapping, extractPhoneNumbers, type StandardField } from '@/lib/import-engine'
import { normalizePhone } from '@/lib/whatsapp'

// Arabic status mapping
const STATUS_MAP: Record<string, string> = {
  'active': 'active', 'pending': 'pending', 'in_negotiation': 'in_negotiation',
  'payment_plan': 'payment_plan', 'settled': 'settled', 'legal': 'legal', 'written_off': 'written_off',
  'نشط': 'active', 'فعال': 'active', 'جديد': 'active', 'مفتوح': 'active', 'قيد التحصيل': 'active',
  'معلق': 'pending', 'قيد المعالجة': 'pending', 'انتظار': 'pending', 'موقوف': 'pending',
  'قيد التفاوض': 'in_negotiation', 'تفاوض': 'in_negotiation', 'تحت التفاوض': 'in_negotiation',
  'خطة سداد': 'payment_plan', 'تقسيط': 'payment_plan', 'اتفاقية سداد': 'payment_plan', 'جدولة': 'payment_plan',
  'مسدد': 'settled', 'مدفوع': 'settled', 'منتهي': 'settled', 'مغلق': 'settled', 'مسوّى': 'settled', 'مسوى': 'settled', 'تسوية': 'settled',
  'قانوني': 'legal', 'محكمة': 'legal', 'إجراء قانوني': 'legal', 'اجراء قانوني': 'legal',
  'مشطوب': 'written_off', 'معدوم': 'written_off', 'شطب': 'written_off', 'هالك': 'written_off',
}

function mapStatus(raw: string | undefined): string {
  if (!raw) return 'active'
  const s = raw.toLowerCase().trim()
  return STATUS_MAP[s] ?? STATUS_MAP[raw.trim()] ?? 'active'
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
      const { error: metaUpdErr } = await supabase.from('portfolios').update({
        metadata: { ...meta, outcome_categories: profile.outcomeCategories, company_key: profile.key },
      }).eq('id', id)
      if (metaUpdErr) logger.error('portfolio outcome_categories metadata update failed', metaUpdErr, { portfolio_id: id })
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
//
// Column mapping is no longer a single global guess for the whole file. Rows
// are clustered by their "active column" layout (see lib/import-engine.ts),
// and EACH layout gets its own mapping resolved independently from header
// text + column content + company profile + previously-confirmed templates.
// A layout that is genuinely ambiguous is NEVER guessed — its rows are
// skipped and reported under `needs_mapping`, never imported with wrong data
// and never silently dropped without explanation.

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

    const companyKey = (formData.get('company_key') as string | null)?.trim() || null
    const companyProfile = companyKey ? findCompanyProfile(companyKey) : null
    const forcedPortfolioId = companyProfile ? await ensureCompanyPortfolio(supabase, profile.company_id, companyProfile) : null

    // Optional: { [signatureHash]: { [header]: StandardField } } — confirms a
    // mapping for one or more ambiguous layouts detected by a prior call to
    // POST /api/debts/import/analyze. Confirmed mappings are persisted below
    // so the SAME layout never needs to be confirmed again, even in a future
    // file that mixes it with other layouts.
    let overrides: Record<string, Record<string, StandardField>> = {}
    const overridesRaw = formData.get('cluster_mapping_overrides') as string | null
    if (overridesRaw) {
      try { overrides = JSON.parse(overridesRaw) } catch { /* ignore malformed overrides */ }
    }

    const allowed = ['.csv', '.xlsx', '.xls']
    const ext = '.' + file.name.split('.').pop()!.toLowerCase()
    if (!allowed.includes(ext))
      return NextResponse.json({ error: 'Must be a .csv or .xlsx file' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024)
      return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 })

    const buf = await file.arrayBuffer()
    let headers: string[]
    let rows: string[][]

    if (ext === '.xlsx' || ext === '.xls' || isXLSX(buf)) {
      try {
        const parsed = parseXLSX(buf)
        headers = parsed.headers
        rows = parsed.rows
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
        rows = parsed.rows
      } catch (csvErr) {
        return NextResponse.json({
          error: csvErr instanceof Error ? csvErr.message : 'Invalid CSV file format'
        }, { status: 400 })
      }
    }

    if (!headers || headers.length === 0)
      return NextResponse.json({ error: 'لم يتم العثور على أعمدة في الملف' }, { status: 400 })

    // ── Load previously-confirmed templates for this company ──
    const { data: templateRows } = await supabase
      .from('import_mapping_templates')
      .select('id, signature_hash, field_map, use_count')
      .eq('company_id', profile.company_id)
    const savedTemplates: Record<string, Record<string, StandardField>> = {}
    const templateIdByHash: Record<string, string> = {}
    for (const t of templateRows ?? []) {
      const row = t as { id: string; signature_hash: string; field_map: Record<string, StandardField> }
      savedTemplates[row.signature_hash] = row.field_map
      templateIdByHash[row.signature_hash] = row.id
    }

    const companyColumnAliases = companyProfile?.columnAliases as Record<string, StandardField | string> | undefined

    // ── Cluster rows by layout, resolve mapping per cluster ──
    const clusters = clusterRowsByLayout(headers, rows)
    type ClusterRuntime = {
      colFieldMap: Record<number, StandardField>
      needsMapping: boolean
      signatureHash: string
      unresolvedFields: string[]
      headerFieldMap: Record<string, StandardField> // for persisting as a template
      // Kept ONLY for the diagnostic needs_mapping report below — never used
      // to decide which rows import (that decision is colFieldMap/needsMapping,
      // unchanged). Candidate columns + a human label per unresolved field, so
      // the UI can show WHY a row was held back instead of it vanishing silently.
      candidatesByField: Record<string, Array<{ header: string; confidence: number }>>
      portfolioLabel: string | null
    }
    const clusterRuntimes: ClusterRuntime[] = []
    const rowToCluster = new Map<number, number>() // rowIdx -> index into clusterRuntimes

    for (const cluster of clusters) {
      const override = overrides[cluster.signatureHash]
      const saved = savedTemplates[cluster.signatureHash]
      const effectiveSaved = override ?? saved // an explicit override always wins over a stale saved template

      const { resolutions, fieldMap, needsMapping } = resolveClusterMapping(headers, rows, cluster, {
        companyColumnAliases,
        savedFieldMap: effectiveSaved,
      })

      const headerFieldMap: Record<string, StandardField> = {}
      for (const [colIdxStr, field] of Object.entries(fieldMap)) headerFieldMap[headers[Number(colIdxStr)]] = field

      const unresolvedFieldNames = Object.entries(resolutions).filter(([, r]) => r.needsMapping).map(([f]) => f)
      const candidatesByField: Record<string, Array<{ header: string; confidence: number }>> = {}
      for (const f of unresolvedFieldNames) {
        candidatesByField[f] = resolutions[f as keyof typeof resolutions].candidates
          .slice(0, 5).map(c => ({ header: c.header, confidence: Math.round(c.score * 100) }))
      }

      // Best-effort human label: a portfolio/company-name-shaped column active
      // in this cluster, or a company-profile alias match on its values —
      // purely cosmetic for the diagnostic report, computed the same way the
      // read-only /analyze endpoint already does.
      let portfolioLabel: string | null = null
      const portfolioColIdx = headers.findIndex((h, i) =>
        cluster.signature.includes(h) && /محفظة|مشروع|portfolio/i.test(h) && cluster.rowIndices.some(r => rows[r][i]?.trim()))
      if (portfolioColIdx !== -1) {
        const val = rows[cluster.rowIndices[0]]?.[portfolioColIdx]
        if (val) portfolioLabel = resolveCompanyProfile(val)?.nameAr ?? val
      }

      const runtimeIdx = clusterRuntimes.length
      clusterRuntimes.push({
        colFieldMap: fieldMap,
        needsMapping,
        signatureHash: cluster.signatureHash,
        unresolvedFields: unresolvedFieldNames,
        headerFieldMap,
        candidatesByField,
        portfolioLabel,
      })
      for (const r of cluster.rowIndices) rowToCluster.set(r, runtimeIdx)
    }

    // Persist every cluster that resolved successfully (auto or via override)
    // as a template — INCLUDING auto-resolved ones, so future imports of the
    // same layout shape are instant and consistent, not re-derived each time.
    for (const cr of clusterRuntimes) {
      if (cr.needsMapping || Object.keys(cr.headerFieldMap).length === 0) continue
      const existingId = templateIdByHash[cr.signatureHash]
      if (existingId) {
        const { error: tmplUpdErr } = await supabase.from('import_mapping_templates').update({
          field_map: cr.headerFieldMap, use_count: (templateRows?.find((t: any) => t.id === existingId)?.use_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
        }).eq('id', existingId)
        if (tmplUpdErr) logger.error('import_mapping_templates update failed', tmplUpdErr, { template_id: existingId })
      } else {
        const { error: tmplInsErr } = await supabase.from('import_mapping_templates').insert({
          company_id: profile.company_id, signature_hash: cr.signatureHash,
          signature_headers: headers.filter(h => clusters.find(c => c.signatureHash === cr.signatureHash)?.signature.includes(h)),
          field_map: cr.headerFieldMap, confirmed_by: overrides[cr.signatureHash] ? user.id : null,
          use_count: 1, last_used_at: new Date().toISOString(),
        })
        if (tmplInsErr) logger.error('import_mapping_templates insert failed', tmplInsErr, { signature_hash: cr.signatureHash })
      }
    }

    // Rows belonging to a cluster that still needs mapping are NEVER
    // imported and NEVER silently skipped — they're reported explicitly.
    const needsMappingClusters = clusterRuntimes
      .map((cr, i) => ({ cr, i }))
      .filter(({ cr }) => cr.needsMapping)
    const needsMappingRowNumbers = new Set<number>()
    for (const { i } of needsMappingClusters) {
      for (const [rowIdx, ci] of rowToCluster.entries()) if (ci === i) needsMappingRowNumbers.add(rowIdx + 2)
    }

    const portfolioCache = new Map<string, string>()
    const results = { imported: 0, skipped: 0, errors: [] as string[] }
    const pipelineEvents: PipelineEvent[] = []

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]
      if (!row || row.every(cell => !cell?.trim())) continue

      if (needsMappingRowNumbers.has(rowIdx + 2)) {
        // Explicitly excluded — surfaced via `needs_mapping` in the response,
        // not counted as a generic error and not imported.
        continue
      }

      const clusterIdx = rowToCluster.get(rowIdx)
      const fieldMap = clusterIdx != null ? clusterRuntimes[clusterIdx].colFieldMap : {}

      const f: Record<string, string> = {}
      for (const [colIdxStr, fieldName] of Object.entries(fieldMap)) {
        const val = row[parseInt(colIdxStr)]?.trim()
        if (val) f[fieldName] = val
      }

      const mappedColIdxs = new Set(Object.keys(fieldMap).map(Number))
      const extra: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        if (mappedColIdxs.has(i)) continue
        const val = row[i]?.trim()
        if (val) extra[headers[i]] = val
      }

      const rawByHeader: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        const val = row[i]?.trim()
        if (val) rawByHeader[headers[i].toLowerCase().trim()] = val
      }

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

        // Auto-derive WhatsApp from phone when no explicit whatsapp column:
        // Saudi numbers starting with 05... → 966..., already-966 kept as-is.
        const resolvedWhatsapp = f.whatsapp
          ? f.whatsapp.replace(/[^\d+]/g, '')
          : (f.phone ? normalizePhone(f.phone) : null)

        if (existing) {
          customerId = (existing as { id: string }).id
          const { error: custUpdErr } = await supabase.from('customers').update({
            full_name:      f.full_name,
            ...(f.phone         && { phone:          f.phone.replace(/[^\d+]/g, '') }),
            ...(resolvedWhatsapp && { whatsapp:       resolvedWhatsapp }),
            ...(f.city          && { city:            f.city }),
            ...(f.employer      && { employer:        f.employer }),
            ...(f.email         && { email:           f.email }),
            ...(f.monthly_income && { monthly_income: parseFloat(f.monthly_income.replace(/[,، ]/g, '')) }),
          }).eq('id', customerId)
          if (custUpdErr) logger.error('customer re-sync update failed on re-import', custUpdErr, { customer_id: customerId })
        } else {
          const { data: newCust, error: custErr } = await supabase.from('customers').insert({
            company_id:     profile.company_id,
            created_by:     user.id,
            full_name:      f.full_name,
            phone:          f.phone?.replace(/[^\d+]/g, '') || null,
            whatsapp:       resolvedWhatsapp || null,
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

        // A "contact numbers" cell can legitimately hold more than one real
        // number for the same customer (their own + a relative's). The
        // FIRST valid number is already customers.phone (unchanged behavior
        // above) — every valid number found, including that first one, is
        // additionally recorded here so a later cron can try the next one
        // if the primary never replies. Any non-numeric text in the same
        // cell never reaches this far — extractPhoneNumbers() only returns
        // tokens that match a real Saudi mobile shape. Re-imports of the
        // same customer only ever ADD a newly-seen number (UNIQUE
        // constraint on customer_id+phone silently no-ops on a repeat).
        const allPhoneNumbers = extractPhoneNumbers(f.phone)
        if (allPhoneNumbers.length > 0) {
          const { error: contactsUpsertErr } = await supabase.from('customer_contacts').upsert(
            allPhoneNumbers.map((phone, i) => ({
              company_id: profile.company_id, customer_id: customerId, phone,
              is_primary: i === 0, source: 'import' as const,
            })),
            { onConflict: 'customer_id,phone', ignoreDuplicates: true },
          )
          if (contactsUpsertErr) logger.error('customer_contacts upsert failed', contactsUpsertErr, { customer_id: customerId })
        }

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

        let dueDate: string | null = null
        if (f.due_date) {
          const raw = f.due_date.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
          const parts = raw.split(/[\/\-\.]/)
          let d: Date | null = null
          if (parts.length === 3) {
            if (parts[0].length === 4)  d = new Date(`${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`)
            else if (parseInt(parts[0]) > 12) d = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`)
            else d = new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`)
          }
          if (d && !isNaN(d.getTime())) dueDate = d.toISOString().split('T')[0]
        }

        // Same parsing as due_date — last_payment_date only ever resolves
        // via an explicit company column alias (see import-engine.ts), so a
        // company's profile claiming this field always means a real header
        // for it exists in that company's file.
        let lastPaymentDate: string | null = null
        if (f.last_payment_date) {
          const raw = f.last_payment_date.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
          const parts = raw.split(/[\/\-\.]/)
          let d: Date | null = null
          if (parts.length === 3) {
            if (parts[0].length === 4)  d = new Date(`${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`)
            else if (parseInt(parts[0]) > 12) d = new Date(`${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`)
            else d = new Date(`${parts[2]}-${parts[0].padStart(2,'0')}-${parts[1].padStart(2,'0')}`)
          }
          if (d && !isNaN(d.getTime())) lastPaymentDate = d.toISOString().split('T')[0]
        }

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
          last_payment_date: lastPaymentDate,
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

    let pipelineResult = { succeeded: 0, failed: 0, skipped: 0, total_alerts: 0, total_actions: 0 }
    if (pipelineEvents.length > 0) {
      try {
        pipelineResult = await processEventBatch(pipelineEvents, 4)
        logger.info('Pipeline complete', { imported: results.imported, pipeline: pipelineResult })
      } catch (pipelineErr) {
        logger.warn('Pipeline batch error', { error: String(pipelineErr) })
      }
    }

    const FIELD_LABELS_AR: Record<string, string> = {
      full_name: 'اسم العميل', national_id: 'رقم الهوية', phone: 'رقم الجوال',
      original_amount: 'المبلغ', current_balance: 'الرصيد الحالي',
    }
    const needsMappingReport = needsMappingClusters.map(({ cr, i }) => {
      const row_numbers = [...rowToCluster.entries()].filter(([, ci]) => ci === i).map(([r]) => r + 2)
      const fields = cr.unresolvedFields.map(field => {
        const candidates = cr.candidatesByField[field] ?? []
        return {
          field,
          field_label: FIELD_LABELS_AR[field] ?? field,
          candidates,
          // Distinguish, in plain language, WHY the row didn't import: either
          // the data genuinely has nothing usable (no candidates at all), or
          // there IS a usable column but the system isn't sure which one
          // (needs a one-time human pick) — never the same vague rejection.
          reason: candidates.length === 0
            ? `لا يوجد أي عمود يحتوي بيانات تصلح لـ"${FIELD_LABELS_AR[field] ?? field}" في هذه الصفوف — المعلومة غير موجودة في الملف فعلياً.`
            : `يوجد أكثر من عمود محتمل لـ"${FIELD_LABELS_AR[field] ?? field}" ولم يستطع النظام الحسم تلقائياً — يحتاج تأكيد يدوي مرة واحدة.`,
        }
      })
      return {
        signature_hash: cr.signatureHash,
        portfolio_label: cr.portfolioLabel,
        row_numbers,
        row_count: row_numbers.length,
        fields,
      }
    })

    return NextResponse.json({
      data:    results,
      pipeline: pipelineResult,
      needs_mapping: needsMappingReport.length > 0 ? needsMappingReport : undefined,
      message: needsMappingReport.length > 0
        ? `Imported ${results.imported} records. ${needsMappingReport.reduce((n, c) => n + c.row_numbers.length, 0)} rows need column mapping confirmation (see needs_mapping) and were NOT imported. Pipeline: ${pipelineResult.succeeded} processed, ${pipelineResult.total_alerts} alerts, ${pipelineResult.total_actions} actions.`
        : `Imported ${results.imported} records. Pipeline: ${pipelineResult.succeeded} processed, ${pipelineResult.total_alerts} alerts, ${pipelineResult.total_actions} actions.`,
    })
  } catch (error) {
    logger.error('Import failed', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 }
    )
  }
}
