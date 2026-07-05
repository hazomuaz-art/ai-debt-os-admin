import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { parseXLSX } from '@/lib/excel-parser'
import { analyzeImportFile } from '@/lib/import-engine'
import { normalizePhone } from '@/lib/whatsapp'
import { buildCampaignQueueRows, type CampaignQueueDebt } from '@/lib/campaign-queue-builder'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/campaign-builder/upload-targets')

type UnmatchedRow = { row: number; national_id: string | null; phone: string | null; reason: string }

// Lets an admin scope a campaign to a SPECIFIC, hand-picked customer list
// (e.g. "these particular 100 accounts from one project, regardless of
// their current status") by uploading an Excel file of national IDs and/or
// phone numbers, instead of the portfolio-wide "every eligible debt" builder
// in ../route.ts. Reuses the SAME generic column-detection engine already
// proven on the main debt importer (import-engine.ts) rather than a new
// hardcoded column-index reader, since a real admin export can have any
// header wording/order. Reuses the same queue-building write path
// (campaign-queue-builder.ts) so personalization-at-send-time and daily
// send limits behave identically to the portfolio-wide path.
export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const form = await req.formData().catch(() => null)
      const file = form?.get('file')
      const campaign_id = form?.get('campaign_id')
      const portfolio_id_raw = form?.get('portfolio_id')
      if (!file || !(file instanceof File)) return errors.badRequest('file is required')
      if (typeof campaign_id !== 'string' || !campaign_id) return errors.badRequest('campaign_id is required')
      const portfolio_id = typeof portfolio_id_raw === 'string' && portfolio_id_raw ? portfolio_id_raw : null

      const { data: campaign, error: campaignError } = await ctx.supabase
        .from('campaigns')
        .select('*')
        .eq('id', campaign_id)
        .eq('company_id', ctx.profile.company_id)
        .maybeSingle()
      if (campaignError) return errors.internal(campaignError.message)
      if (!campaign) return errors.notFound('Campaign')

      const targetPortfolioId = portfolio_id ?? campaign.portfolio_id ?? null
      if (!targetPortfolioId) return errors.badRequest('portfolio_id required until campaign has portfolio_id')

      const { data: whatsappNumber, error: numberError } = await ctx.supabase
        .from('portfolio_whatsapp_numbers')
        .select('*')
        .eq('company_id', ctx.profile.company_id)
        .eq('portfolio_id', targetPortfolioId)
        .eq('is_active', true)
        .order('sent_today', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (numberError) return errors.internal(numberError.message)
      if (!whatsappNumber) return errors.badRequest('No active WhatsApp number linked to this portfolio')

      const buf = await file.arrayBuffer()
      let parsed: { headers: string[]; rows: string[][] }
      try {
        parsed = parseXLSX(buf)
      } catch (err) {
        return errors.badRequest('Failed to parse Excel file: ' + (err instanceof Error ? err.message : String(err)))
      }
      if (!parsed.rows.length) return errors.badRequest('No data rows found in file')

      const { clusters } = analyzeImportFile(parsed.headers, parsed.rows)

      // Collect (national_id, phone) per row using EACH cluster's own
      // resolved column mapping — a single uploaded list can still mix
      // layouts (e.g. some rows exported with a whatsapp column, others not).
      const identifiers: Array<{ row: number; national_id: string | null; phone: string | null }> = []
      let anyIdentifierColumnFound = false
      for (const cluster of clusters) {
        const nationalIdCol = Object.entries(cluster.fieldMap).find(([, f]) => f === 'national_id')?.[0]
        const phoneCol = Object.entries(cluster.fieldMap).find(([, f]) => f === 'phone' || f === 'whatsapp')?.[0]
        if (nationalIdCol || phoneCol) anyIdentifierColumnFound = true
        for (const rowIdx of cluster.rowIndices) {
          const row = parsed.rows[rowIdx]
          const national_id = nationalIdCol ? (row[Number(nationalIdCol)] ?? '').trim() || null : null
          const phone = phoneCol ? (row[Number(phoneCol)] ?? '').trim() || null : null
          if (national_id || phone) identifiers.push({ row: rowIdx + 2, national_id, phone })
        }
      }

      if (!anyIdentifierColumnFound || identifiers.length === 0) {
        return errors.badRequest('لم يتم العثور على عمود يحتوي على رقم الهوية أو الجوال في الملف — تأكد من وجود عمود واضح لأحدهما')
      }

      const unmatched: UnmatchedRow[] = []
      const matchedCustomerIds = new Set<string>()

      for (const id of identifiers) {
        let customerId: string | null = null

        if (id.national_id) {
          const { data } = await ctx.supabase
            .from('customers')
            .select('id')
            .eq('company_id', ctx.profile.company_id)
            .eq('national_id', id.national_id)
            .maybeSingle()
          customerId = data?.id ?? null
        }

        if (!customerId && id.phone) {
          const normalized = normalizePhone(id.phone)
          if (normalized) {
            const { data } = await ctx.supabase
              .from('customers')
              .select('id')
              .eq('company_id', ctx.profile.company_id)
              .or(`phone.eq.${normalized},whatsapp.eq.${normalized},phone.eq.+${normalized},whatsapp.eq.+${normalized}`)
              .limit(1)
              .maybeSingle()
            customerId = data?.id ?? null
          }
        }

        if (customerId) matchedCustomerIds.add(customerId)
        else unmatched.push({ row: id.row, national_id: id.national_id, phone: id.phone, reason: 'customer_not_found' })
      }

      if (matchedCustomerIds.size === 0) {
        return NextResponse.json({
          data: {
            campaign_id, portfolio_id: targetPortfolioId,
            rows_in_file: identifiers.length, matched_customers: 0,
            recipients_created: 0, queue_created: 0, unmatched,
            message: 'لم يتم مطابقة أي عميل من الملف مع عملاء موجودين في النظام',
          },
        })
      }

      const { data: debts, error: debtsError } = await ctx.supabase
        .from('debts')
        .select('id, customer_id, portfolio_id, status, current_balance, priority')
        .eq('company_id', ctx.profile.company_id)
        .eq('portfolio_id', targetPortfolioId)
        .in('customer_id', Array.from(matchedCustomerIds))
        .not('status', 'in', '("settled","written_off")')
      if (debtsError) return errors.internal(debtsError.message)

      const matchedWithDebt = new Set((debts ?? []).map((d: any) => d.customer_id))
      for (const customerId of matchedCustomerIds) {
        if (!matchedWithDebt.has(customerId)) {
          unmatched.push({ row: -1, national_id: null, phone: null, reason: `customer ${customerId} has no active debt in this portfolio` })
        }
      }

      let result = { recipients_created: 0, queue_created: 0 }
      if (debts && debts.length > 0) {
        try {
          result = await buildCampaignQueueRows({
            supabase: ctx.supabase,
            company_id: ctx.profile.company_id,
            campaign_id,
            portfolio_id: targetPortfolioId,
            whatsapp_number_id: whatsappNumber.id,
            debts: debts as CampaignQueueDebt[],
            source: 'campaign_builder_upload',
            campaign_target_count: campaign.target_count ?? 0,
            campaign_status: campaign.status,
          })
        } catch (err) {
          return errors.internal(err instanceof Error ? err.message : String(err))
        }
      }

      log.info('campaign upload-targets processed', {
        campaign_id, rows_in_file: identifiers.length, matched_customers: matchedCustomerIds.size, ...result,
      })

      return NextResponse.json({
        data: {
          campaign_id,
          portfolio_id: targetPortfolioId,
          whatsapp_number_id: whatsappNumber.id,
          rows_in_file: identifiers.length,
          matched_customers: matchedCustomerIds.size,
          ...result,
          unmatched,
        },
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
