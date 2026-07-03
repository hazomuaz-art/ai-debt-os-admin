import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { generateDailyActionPlan } from '@/lib/ai-engine'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/ai/recommend')
const RATE_LIMIT_KEY = 'ai_recommend'
const HOURLY_LIMIT   = 500  // Raised — pipeline generates per-debt, not bulk

export async function POST(_request: NextRequest) {
  return withAuth(
    async (ctx) => {
      // Rate limit (best-effort — skip if function not deployed)
      try {
        const r = await ctx.supabase.rpc('check_and_increment_rate_limit', {
          p_key: RATE_LIMIT_KEY, p_company_id: ctx.profile.company_id, p_limit_max: HOURLY_LIMIT,
        })
        if (r.data === false) return errors.rateLimited()
      } catch { /* not deployed yet */ }

      // Fetch company name
      const { data: company } = await ctx.supabase
        .from('companies').select('name').eq('id', ctx.profile.company_id).single()

      // Fetch active debts with customer + latest score
      const { data: debts, error: debtsErr } = await ctx.supabase
        .from('debts')
        .select(`*, customer:customers(full_name, phone, whatsapp, monthly_income, risk_level), ai_scores(score, risk_classification, collection_probability, created_at)`)
        .eq('company_id', ctx.profile.company_id)
        .not('status', 'in', '("settled","written_off")')
        .order('current_balance', { ascending: false })
        .limit(500)  // All active debts — no artificial cap

      if (debtsErr) {
        log.error('Failed to fetch debts', debtsErr)
        return errors.internal('Failed to fetch debts: ' + (debtsErr as { message?: string }).message)
      }

      if (!debts?.length) {
        return NextResponse.json({ success: true, count: 0, actions: [], message: 'No eligible debts found. Add active debts to generate an action plan.' })
      }

      // Attach latest AI score to each debt
      const debtsWithScore = debts.map((d: Record<string, unknown>) => {
        const scores = ((d.ai_scores as Array<{ created_at: string }> | null) ?? [])
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        return { ...d, ai_score: scores[0] ?? null }
      })

      const today = new Date().toISOString().split('T')[0]

      // Generate action plan — AI or rule-based fallback, never throws
      let actions = await generateDailyActionPlan({
        debts:        debtsWithScore as Parameters<typeof generateDailyActionPlan>[0]['debts'],
        date:         today,
        company_name: (company?.name as string) ?? 'Unknown',
      })

      if (!actions.length) {
        return NextResponse.json({ success: true, count: 0, actions: [], message: 'AI returned no actions for current debts.' })
      }

      // Delete today's pending actions before re-inserting
      // Real gap found during a full-system audit: unchecked — a rejected
      // delete followed by the (checked) insert below produces duplicate
      // pending actions for the same day instead of a clean replace.
      const { error: deleteOldActionsErr } = await ctx.supabase
        .from('ai_actions').delete()
        .eq('company_id', ctx.profile.company_id)
        .eq('scheduled_for', today)
        .eq('status', 'pending')
      if (deleteOldActionsErr) log.error('failed to clear prior pending ai_actions before re-generating', new Error(deleteOldActionsErr.message), { company_id: ctx.profile.company_id })

      // Build insert rows — only columns guaranteed to exist in schema
      const priorityScore: Record<string, number> = { critical: 100, high: 75, medium: 50, low: 25 }

      const rows = actions.map(a => {
        const matchedDebt = debts.find((d: { id: string }) => d.id === a.debt_id) as Record<string, unknown> | undefined
        return {
          company_id:           ctx.profile.company_id,
          debt_id:              a.debt_id,
          customer_id:          a.customer_id,
          assigned_to:          (matchedDebt?.assigned_to as string | null) ?? null,
          action_type:          a.action_type,
          priority:             a.priority,
          priority_score:       priorityScore[a.priority] ?? 50,
          reason:               a.reason,
          suggested_message:    a.suggested_message,
          best_time_to_contact: a.best_time_to_contact,
          scheduled_for:        today,
          scheduled_date:       today,
          status:               'pending',
        }
      })

      log.info('Inserting AI actions', { count: rows.length, sample_priority: rows[0]?.priority, sample_action_type: rows[0]?.action_type })

      const { data: inserted, error: insertErr } = await ctx.supabase
        .from('ai_actions').insert(rows).select()

      if (insertErr) {
        const err = insertErr as { code?: string; message?: string; details?: string; hint?: string }
        log.error('Insert failed', new Error(err.message ?? 'unknown'), { code: err.code, message: err.message, details: err.details, hint: err.hint, sample_row: rows[0] })
        return NextResponse.json(
          { success: false, count: 0, actions: [], error: `Database insert failed: ${err.message ?? 'unknown'} (code: ${err.code ?? '?'})` },
          { status: 500 }
        )
      }

      const count = inserted?.length ?? 0
      log.info('AI actions saved', { count })

      return NextResponse.json({
        success: true,
        count,
        actions: inserted ?? [],
        message: count === 1 ? 'Generated 1 action' : `Generated ${count} actions`,
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
