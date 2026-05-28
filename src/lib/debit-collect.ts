/**
 * Debit Collect / Tamiuzz Integration Layer
 *
 * Handles:
 *   - Fetching records from Debit Collect or Tamiuzz API
 *   - Mapping external records to internal Portfolio/Customer/Debt
 *   - Persisting sync results to debit_collect_sync table
 *   - Updating debts with collector_name, last_contact_result, portfolio_id
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import type { DebitCollectRecord, SyncResult } from '@/types'

const log = createLogger('debit-collect')

// â”€â”€ Fetch records from external system â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface FetchOptions {
  api_url:      string
  api_key:      string
  source:       'debit_collect' | 'tamiuzz'
  portfolio_code?: string  // optional: filter by portfolio
  page?:        number
  per_page?:    number
}

export async function fetchRecords(opts: FetchOptions): Promise<{
  records: DebitCollectRecord[]
  total:   number
  error?:  string
}> {
  const { api_url, api_key, source, portfolio_code, page = 1, per_page = 100 } = opts

  if (!api_url || !api_key) {
    return { records: [], total: 0, error: 'API URL and Key are required' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const url = new URL(`${api_url.replace(/\/$/, '')}/debts`)
    url.searchParams.set('page', String(page))
    url.searchParams.set('per_page', String(per_page))
    if (portfolio_code) url.searchParams.set('portfolio', portfolio_code)

    const res = await fetch(url.toString(), {
      method:  'GET',
      headers: {
        'Authorization': source === 'tamiuzz' ? `Bearer ${api_key}` : `ApiKey ${api_key}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!res.ok) {
      return { records: [], total: 0, error: `HTTP ${res.status}: ${res.statusText}` }
    }

    const data = await res.json() as {
      data?:    DebitCollectRecord[]
      records?: DebitCollectRecord[]
      items?:   DebitCollectRecord[]
      total?:   number
      count?:   number
    }

    const records = data.data ?? data.records ?? data.items ?? []
    const total   = data.total ?? data.count ?? records.length

    return { records: records as DebitCollectRecord[], total }
  } catch (err) {
    clearTimeout(timer)
    const msg = err instanceof Error
      ? (err.name === 'AbortError' ? 'Request timed out (15s)' : err.message)
      : 'Fetch failed'
    return { records: [], total: 0, error: msg }
  }
}

// â”€â”€ Process and map a batch of records â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ProcessOptions {
  company_id:  string
  source:      'debit_collect' | 'tamiuzz' | 'manual'
  records:     DebitCollectRecord[]
  synced_by?:  string
}

export async function processRecords(opts: ProcessOptions): Promise<SyncResult> {
  const supabase = createServiceClient()

  const syncRow = {
    company_id:     opts.company_id,
    source_system:  opts.source,
    sync_type:      'incremental' as const,
    status:         'running' as const,
    records_total:  opts.records.length,
    records_processed: 0,
    records_failed: 0,
    synced_by:      opts.synced_by ?? null,
  }

  // Create a summary sync record (single row for this batch)
  const { data: syncRecord, error: syncErr } = await supabase
    .from('debit_collect_sync')
    .insert(syncRow)
    .select()
    .single()

  if (syncErr || !syncRecord) {
    log.error('Failed to create sync record', syncErr)
    return {
      id: '', company_id: opts.company_id,
      source_system: opts.source, sync_type: 'incremental', status: 'failed',
      records_total: opts.records.length, records_processed: 0, records_failed: opts.records.length,
      error_log: [syncErr?.message], started_at: new Date().toISOString(),
    }
  }

  // Load portfolio map: code â†’ id
  const { data: portfolios } = await supabase
    .from('portfolios')
    .select('id, code, name')
    .eq('company_id', opts.company_id)

  const portfolioByCode = new Map(
    (portfolios ?? []).map(p => [p.code?.toUpperCase(), p])
  )
  const portfolioByName = new Map(
    (portfolios ?? []).map(p => [p.name?.toLowerCase(), p])
  )

  let processed = 0
  let failed    = 0
  let skipped   = 0
  const errorLog: string[] = []

  const SKIP_STATUSES = new Set(['settled', 'paid', 'closed', 'written_off', 'cancelled'])

  for (const rec of opts.records) {
    try {
      const rawStatus = (rec.payment_status ?? '').toLowerCase()
      const isSettled = SKIP_STATUSES.has(rawStatus) ||
        rawStatus.includes('paid') ||
        rawStatus.includes('settled') ||
        rawStatus.includes('closed') ||
        rawStatus.includes('مسدد') ||
        rawStatus.includes('مغلق') ||
        rawStatus.includes('منتهي')

      if (isSettled) skipped++

      // Resolve portfolio
      const portfolioCode = rec.portfolio_code?.toUpperCase()
      const portfolio = portfolioByCode.get(portfolioCode ?? '') ??
                        portfolioByName.get(rec.portfolio_name?.toLowerCase() ?? '')

      // Upsert customer by national_id or phone
      let customerId: string | null = null

      if (rec.customer_national_id) {
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('company_id', opts.company_id)
          .eq('national_id', rec.customer_national_id)
          .maybeSingle()

        if (existing) {
          customerId = (existing as { id: string }).id
        }
      }

      if (!customerId && rec.customer_phone) {
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('company_id', opts.company_id)
          .eq('phone', rec.customer_phone)
          .maybeSingle()

        if (existing) {
          customerId = (existing as { id: string }).id
        }
      }

      if (!customerId) {
        // Create new customer
        const { data: newCustomer } = await supabase
          .from('customers')
          .insert({
            company_id:  opts.company_id,
            full_name:   rec.customer_name,
            phone:       rec.customer_phone || null,
            national_id: rec.customer_national_id || null,
          })
          .select('id')
          .single()

        customerId = (newCustomer as { id: string } | null)?.id ?? null
      }

      // Find or create debt by external_ref
      let debtId: string | null = null

      if (rec.external_debt_id && customerId) {
        const { data: existingDebt } = await supabase
          .from('debts')
          .select('id')
          .eq('company_id', opts.company_id)
          .eq('external_ref', rec.external_debt_id)
          .maybeSingle()

        if (existingDebt) {
          debtId = (existingDebt as { id: string }).id
          // Update with latest sync data
          await supabase
            .from('debts')
            .update({
              current_balance:       rec.remaining_amount,
              portfolio_id:          portfolio?.id ?? null,
              collector_name:        rec.collector_name || null,
              last_contact_result:   rec.last_contact_result || null,
              last_contact_at:       rec.last_contact_date
                ? new Date(rec.last_contact_date).toISOString()
                : null,
            })
            .eq('id', debtId)
        } else if (customerId) {
          // Create new debt
          const { data: newDebt } = await supabase
            .from('debts')
            .insert({
              company_id:          opts.company_id,
              customer_id:         customerId,
              reference_number:    rec.external_debt_id,
              external_ref:        rec.external_debt_id,
              original_amount:     rec.debt_amount,
              current_balance:     rec.remaining_amount,
              currency:            'SAR',
              status:              mapPaymentStatus(rec.payment_status),
              priority:            isSettled ? 'low' : 'medium',
              portfolio_id:        portfolio?.id ?? null,
              collector_name:      rec.collector_name || null,
              last_contact_result: rec.last_contact_result || null,
              notes:               rec.notes || null,
            })
            .select('id')
            .single()

          debtId = (newDebt as { id: string } | null)?.id ?? null
        }
      }

      // Log this individual sync record
      await supabase.from('debit_collect_sync').insert({
        company_id:             opts.company_id,
        source_system:          opts.source,
        sync_type:              'single',
        status:                 'completed',
        external_customer_id:   rec.external_customer_id,
        external_debt_id:       rec.external_debt_id,
        portfolio_name:         rec.portfolio_name,
        portfolio_code:         rec.portfolio_code,
        customer_name:          rec.customer_name,
        customer_phone:         rec.customer_phone,
        customer_national_id:   rec.customer_national_id,
        debt_amount:            rec.debt_amount,
        remaining_amount:       rec.remaining_amount,
        payment_status:         rec.payment_status,
        contact_status:         rec.contact_status,
        collector_name:         rec.collector_name,
        last_contact_result:    rec.last_contact_result,
        last_contact_date:      rec.last_contact_date || null,
        notes:                  rec.notes,
        mapped_customer_id:     customerId,
        mapped_debt_id:         debtId,
        mapped_portfolio_id:    portfolio?.id ?? null,
        raw_payload:            rec as unknown as Record<string, unknown>,
        raw_remarks:            (rec.remarks ?? []) as unknown as Record<string, unknown>[],
        raw_payments:           (rec.payments ?? []) as unknown as Record<string, unknown>[],
        raw_promises:           (rec.promises ?? []) as unknown as Record<string, unknown>[],
        remarks_count:          rec.remarks?.length ?? 0,
        payments_count:         rec.payments?.length ?? 0,
        promises_count:         rec.promises?.length ?? 0,
        skipped_count:          isSettled ? 1 : 0,
        skip_reason:            isSettled ? 'Settled or closed case' : null,
        ai_memory_imported:     false,
        started_at:             new Date().toISOString(),
        completed_at:           new Date().toISOString(),
      })

      processed++
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      errorLog.push(`${rec.external_debt_id ?? '?'}: ${msg}`)
      log.error('Failed to process sync record', err, { external_id: rec.external_debt_id })
    }
  }

  // Update summary record
  const finalStatus = failed === 0 ? 'completed' : processed === 0 ? 'failed' : 'partial'
  await supabase.from('debit_collect_sync').update({
    status:            finalStatus,
    records_processed: processed,
    records_failed:    failed,
    skipped_count:     skipped,
    error_log:         errorLog,
    completed_at:      new Date().toISOString(),
  }).eq('id', syncRecord.id)

  return {
    ...syncRecord,
    status:            finalStatus,
    records_processed: processed,
    records_failed:    failed,
    skipped_count:     skipped,
    error_log:         errorLog,
    completed_at:      new Date().toISOString(),
  }
}

// â”€â”€ Map external payment status to internal DebtStatus â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function mapPaymentStatus(externalStatus: string): string {
  const s = externalStatus?.toLowerCase() ?? ''
  if (s.includes('paid') || s.includes('settled'))    return 'settled'
  if (s.includes('partial'))                           return 'partial'
  if (s.includes('legal') || s.includes('court'))     return 'legal'
  if (s.includes('promise') || s.includes('promised')) return 'promised'
  if (s.includes('negoti'))                            return 'in_negotiation'
  return 'active'
}


