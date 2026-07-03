import { NextRequest, NextResponse } from 'next/server'
import { withAuth, parseBody, errors, scoreDebtSchema } from '@/lib/api'
import { scoreDebt } from '@/lib/ai-engine'
import { calculateDaysOverdue } from '@/lib/utils'
import { createLogger } from '@/lib/logger'
import { trackEvent, checkAICallLimit } from '@/lib/usage-tracker'

const log = createLogger('api/ai/score')
const RATE_LIMIT_KEY = 'ai_score'
const HOURLY_LIMIT   = 50

export async function POST(request: NextRequest) {
  return withAuth(async (ctx) => {
    const { data: body, error: parseErr } = await parseBody(request, scoreDebtSchema)
    if (parseErr) return parseErr

    // Hard usage limit check from system_config
    const limitCheck = await checkAICallLimit(ctx.profile.company_id)
    if (!limitCheck.allowed) {
      return NextResponse.json({ error: limitCheck.reason ?? 'Daily AI limit reached', code: 'RATE_LIMITED' }, { status: 429 })
    }

    // Supabase rate limit check — if function not yet deployed, allow through
    try {
      const rateCheck = await ctx.supabase.rpc('check_and_increment_rate_limit', {
        p_key:        RATE_LIMIT_KEY,
        p_company_id: ctx.profile.company_id,
        p_limit_max:  HOURLY_LIMIT,
      })
      if (rateCheck.data === false) return errors.rateLimited()
    } catch {
      // Function not available — skip rate limiting
    }

    const { data: debt, error: debtErr } = await ctx.supabase
      .from('debts')
      .select('*, customer:customers(*)')
      .eq('id', body.debt_id)
      .eq('company_id', ctx.profile.company_id)
      .single()

    if (debtErr || !debt) return errors.notFound('Debt')

    const customer = debt.customer as Record<string, unknown>
    if (!customer) return errors.notFound('Customer')

    const { data: payments } = await ctx.supabase
      .from('payments')
      .select('amount, payment_date, status')
      .eq('debt_id', body.debt_id)
      .order('payment_date', { ascending: false })
      .limit(20)

    const daysOverdue = debt.due_date ? calculateDaysOverdue(debt.due_date as string) : 0

    const scoreResult = await scoreDebt({
      debt:                debt as Parameters<typeof scoreDebt>[0]['debt'],
      customer:            customer as unknown as Parameters<typeof scoreDebt>[0]['customer'],
      payment_history:     (payments ?? []).map((p: { amount: unknown; payment_date: string; status: string }) => ({
        amount: Number(p.amount),
        date:   p.payment_date,
        status: p.status,
      })),
      days_overdue:        daysOverdue,
      total_payments_made: payments?.length ?? 0,
    })

    const { data: aiScore, error: insertErr } = await ctx.supabase
      .from('ai_scores')
      .insert({
        company_id:             ctx.profile.company_id,
        debt_id:                body.debt_id,
        customer_id:            (debt as { customer_id: string }).customer_id,
        score:                  scoreResult.score,
        risk_classification:    scoreResult.risk_classification,
        collection_probability: scoreResult.collection_probability / 100,
        recommended_strategy:   scoreResult.recommended_strategy,
        factors:                scoreResult.factors,
      })
      .select()
      .single()

    if (insertErr) {
      log.error('AI score insert failed', insertErr)
      return errors.internal('Failed to save score')
    }

    const newPriority =
      scoreResult.score < 25 ? 'critical' :
      scoreResult.score < 50 ? 'high'     :
      scoreResult.score < 75 ? 'medium'   : 'low'

    // Real gap found during a full-system audit: unchecked, unlike the
    // ai_scores insert right above it — a rejected update leaves the debt's
    // priority stale after a rescoring, silently mismatching the score just
    // saved.
    const { error: priorityUpdErr } = await ctx.supabase
      .from('debts')
      .update({ priority: newPriority })
      .eq('id', body.debt_id)
    if (priorityUpdErr) log.error('debt priority update failed after scoring', priorityUpdErr, { debt_id: body.debt_id })

    // Track usage (non-blocking)
    trackEvent({ company_id: ctx.profile.company_id, event_type: 'ai_action', user_id: ctx.user.id, debt_id: body.debt_id }).catch(() => {})

    return NextResponse.json({ data: aiScore })
  })
}
