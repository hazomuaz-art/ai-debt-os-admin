/**
 * POST /api/orchestrator
 * Trigger the AI System Orchestrator for a specific debt/customer or batch.
 *
 * Body:
 *   { source, debt_id, customer_id, data }   — single event
 *   { source, batch: true }                  — all active debts
 *
 * GET /api/orchestrator
 * Return recent orchestrator runs + stats for this company.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import {
  orchestrate, orchestrateBatch,
  getRecentRuns, getRunStats,
  type EventSource,
} from '@/lib/orchestrator'
import { z } from 'zod'

const schema = z.object({
  source: z.enum([
    'csv_import','excel_import','api_sync',
    'webhook_whatsapp','webhook_call',
    'payment_update','promise_update','collector_note',
    'debt_update','customer_update','manual',
  ]).default('manual'),
  debt_id:     z.string().uuid().optional(),
  customer_id: z.string().uuid().optional(),
  data:        z.record(z.unknown()).optional(),
  batch:       z.boolean().optional().default(false),
})

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = schema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { source, debt_id, customer_id, data, batch } = parsed.data

      // Batch mode: process all active debts for this company
      if (batch) {
        const { data: debts } = await ctx.supabase
          .from('debts')
          .select('id, customer_id, status, notes')
          .eq('company_id', ctx.profile.company_id)
          .not('status', 'in', '("settled","written_off","closed")')
          .order('current_balance', { ascending: false })
          .limit(200)

        if (!debts?.length) {
          return NextResponse.json({
            success: true,
            message: 'No active debts to process',
            total: 0,
          })
        }

        const result = await orchestrateBatch({
          source:     source as EventSource,
          company_id: ctx.profile.company_id,
          actor_id:   ctx.user.id,
          records:    debts.map((d: Record<string,string>) => ({
            debt_id:     (d as Record<string,string>).id,
            customer_id: (d as Record<string,string>).customer_id,
            data:        { status: (d as Record<string,string>).status },
          })),
          concurrency: 4,
        })

        return NextResponse.json({
          success: result.succeeded > 0,
          ...result,
          message: `Processed ${result.total} debts: ${result.succeeded} succeeded, ${result.failed} failed, ${result.skipped} skipped. Created ${result.total_actions} actions, ${result.total_alerts} alerts.`,
        })
      }

      // Single event
      if (!debt_id && !customer_id) {
        return errors.badRequest('Provide debt_id, customer_id, or batch:true')
      }

      const result = await orchestrate({
        source:      source as EventSource,
        company_id:  ctx.profile.company_id,
        actor_id:    ctx.user.id,
        debt_id,
        customer_id,
        data:        data as Record<string, unknown> | undefined,
      })

      return NextResponse.json({
        ...result,
        message: result.success
          ? `Orchestrated successfully. Score: ${result.ai_score_value ?? 'N/A'}, Actions: ${result.actions_created}, Alerts: ${result.alerts_created}`
          : `Orchestration failed: ${result.error ?? 'unknown error'}`,
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}

export async function GET(_req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const [runs, stats] = await Promise.all([
        getRecentRuns(ctx.profile.company_id, 30),
        getRunStats(ctx.profile.company_id),
      ])

      return NextResponse.json({
        success: true,
        stats,
        runs,
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
