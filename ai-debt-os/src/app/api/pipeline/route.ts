/**
 * POST /api/pipeline
 * Manually trigger the automation pipeline for a specific customer/debt.
 * Also used by the job worker for async pipeline execution.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { processEvent, processEventBatch, type EventSource } from '@/lib/automation-pipeline'
import { z } from 'zod'

const schema = z.object({
  source:       z.enum(['csv_import','excel_import','api_sync','webhook_whatsapp','webhook_call',
                         'payment_update','promise_update','collector_note','debt_update',
                         'customer_update','manual']).default('manual'),
  customer_id:  z.string().uuid().optional(),
  debt_id:      z.string().uuid().optional(),
  data:         z.record(z.unknown()).optional(),
  // Batch mode: process all active debts for the company
  batch:        z.boolean().optional().default(false),
})

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = schema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { source, customer_id, debt_id, data, batch } = parsed.data

      if (batch) {
        // Process all active debts for this company
        const { data: debts } = await ctx.supabase
          .from('debts')
          .select('id, customer_id, status, notes')
          .eq('company_id', ctx.profile.company_id)
          .not('status', 'in', '("settled","written_off")')
          .order('current_balance', { ascending: false })
          .limit(100)

        if (!debts?.length) {
          return NextResponse.json({ success: true, message: 'No active debts to process', count: 0 })
        }

        const events = debts.map((d: Record<string,unknown>) => ({
          source:       source as EventSource,
          company_id:   ctx.profile.company_id,
          actor_id:     ctx.user.id,
          _customer_id: (d as Record<string,string>).customer_id,
          _debt_id:     (d as Record<string,string>).id,
          data:         { status: (d as Record<string,string>).status },
        }))

        // Run async — don't block response
        processEventBatch(events, 3).catch(() => {})

        return NextResponse.json({
          success: true,
          message: `Pipeline queued for ${events.length} debts`,
          count:   events.length,
        })
      }

      // Single event
      if (!customer_id && !debt_id) {
        return errors.badRequest('Either customer_id, debt_id, or batch:true is required')
      }

      const result = await processEvent({
        source: source as EventSource,
        company_id:   ctx.profile.company_id,
        actor_id:     ctx.user.id,
        _customer_id: customer_id,
        _debt_id:     debt_id,
        data:         data as Record<string, unknown> | undefined,
      })

      return NextResponse.json({ success: result.success, result })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}

export async function GET(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      // Return pipeline status: recent timeline events + automation config
      const [
        { data: recentEvents },
        { data: config },
        { count: activeDebts },
      ] = await Promise.all([
        ctx.supabase
          .from('timeline_events')
          .select('event_type, summary, occurred_at, actor_type')
          .eq('company_id', ctx.profile.company_id)
          .order('occurred_at', { ascending: false })
          .limit(10),
        ctx.supabase
          .from('system_config')
          .select('automation_mode, emergency_stop_all, daily_ai_calls_limit')
          .eq('company_id', ctx.profile.company_id)
          .maybeSingle(),
        ctx.supabase
          .from('debts')
          .select('id', { count: 'exact', head: true })
          .eq('company_id', ctx.profile.company_id)
          .not('status', 'in', '("settled","written_off")'),
      ])

      const cfg = config as Record<string, unknown> | null

      return NextResponse.json({
        status: {
          mode:           cfg?.automation_mode ?? 'off',
          emergency_stop: !!(cfg?.emergency_stop_all),
          active_debts:   activeDebts ?? 0,
        },
        recent_events: recentEvents ?? [],
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
