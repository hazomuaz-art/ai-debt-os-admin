import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { fetchRecords, processRecords } from '@/lib/debit-collect'
import { processEventBatch, type PipelineEvent } from '@/lib/automation-pipeline'
import { z } from 'zod'

const syncSchema = z.object({
  source:          z.enum(['debit_collect', 'tamiuzz', 'manual']),
  api_url:         z.string().url().optional(),
  api_key:         z.string().optional(),
  portfolio_code:  z.string().optional(),
  records:         z.array(z.record(z.unknown())).optional(), // manual upload
})

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = syncSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { source, api_url, api_key, portfolio_code, records: manualRecords } = parsed.data

      let records = manualRecords ?? []
      let total   = records.length
      let fetchError: string | undefined

      // If not manual, fetch from external API
      if (source !== 'manual' && api_url && api_key) {
        const fetched = await fetchRecords({
          api_url, api_key,
          source: source as 'debit_collect' | 'tamiuzz',
          portfolio_code,
          per_page: 200,
        })
        if (fetched.error) fetchError = fetched.error
        else {
          records = fetched.records as Record<string, unknown>[]
          total   = fetched.total
        }
      }

      if (fetchError) {
        return NextResponse.json(
          { success: false, error: fetchError },
          { status: 502 }
        )
      }

      if (!records.length) {
        return NextResponse.json({ success: true, result: { records_total: 0, records_processed: 0, records_failed: 0 } })
      }

      // Process records
      const result = await processRecords({
        company_id: ctx.profile.company_id,
        source:     source as 'debit_collect' | 'tamiuzz' | 'manual',
        records:    records as Parameters<typeof processRecords>[0]['records'],
        synced_by:  ctx.user.id,
      })

      // Queue pipeline events for each synced record
      if (result.records_processed > 0) {
        // Fetch recently created debts for this sync to pass through pipeline
        const { data: recentDebts } = await ctx.supabase
          .from('debts')
          .select('id, customer_id, status, notes')
          .eq('company_id', ctx.profile.company_id)
          .order('created_at', { ascending: false })
          .limit(result.records_processed + 5)

        if (recentDebts?.length) {
          const pipelineEvents: PipelineEvent[] = recentDebts.map((d: Record<string,unknown>) => ({
            source:       'api_sync' as const,
            company_id:   ctx.profile.company_id,
            actor_id:     ctx.user.id,
            _customer_id: (d as Record<string,string>).customer_id,
            _debt_id:     (d as Record<string,string>).id,
            data:         { status: (d as Record<string,string>).status, notes: (d as Record<string,string>).notes },
          }))
          processEventBatch(pipelineEvents, 2).catch(() => {})
        }
      }

      return NextResponse.json({ success: true, total, result })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}

// GET: list recent sync logs
export async function GET(_req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { data, error } = await ctx.supabase
        .from('debit_collect_sync')
        .select('id, source_system, sync_type, status, records_total, records_processed, records_failed, started_at, completed_at, portfolio_name, collector_name, customer_name, debt_amount, remaining_amount, payment_status')
        .eq('company_id', ctx.profile.company_id)
        .order('created_at', { ascending: false })
        .limit(100)

      if (error) return errors.internal(error.message)
      return NextResponse.json({ data: data ?? [] })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
