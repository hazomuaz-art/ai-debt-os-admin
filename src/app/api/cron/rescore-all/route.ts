import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { scoreDebt } from '@/lib/ai-engine'
import { calculateDaysOverdue } from '@/lib/utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/rescore-all')
const MAX = 100

// Re-scores all open debts (so stored strategies/factors become Arabic).
// Auth: Bearer APP_SECRET / CRON_SECRET. Does NOT send any messages.
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data: debts } = await supabase
    .from('debts')
    .select('*, customer:customers(*)')
    .not('status', 'in', '("settled","written_off")')
    .order('created_at', { ascending: false })
    .limit(MAX)

  const results = { total: debts?.length ?? 0, scored: 0, failed: 0 }

  for (const debt of debts ?? []) {
    const customer = (debt as any).customer
    if (!customer) { results.failed++; continue }
    try {
      const { data: payments } = await supabase
        .from('payments').select('amount, payment_date, status')
        .eq('debt_id', debt.id).order('payment_date', { ascending: false }).limit(20)

      const daysOverdue = debt.due_date ? calculateDaysOverdue(debt.due_date) : 0
      const r = await scoreDebt({
        debt: debt as any,
        customer: customer as any,
        payment_history: (payments ?? []).map((p: any) => ({ amount: Number(p.amount), date: p.payment_date, status: p.status })),
        days_overdue: daysOverdue,
        total_payments_made: payments?.length ?? 0,
      })

      await supabase.from('ai_scores').insert({
        company_id: debt.company_id,
        debt_id: debt.id,
        customer_id: debt.customer_id,
        score: r.score,
        risk_classification: r.risk_classification,
        collection_probability: r.collection_probability / 100,
        recommended_strategy: r.recommended_strategy,
        factors: r.factors,
      })

      const newPriority = r.score < 25 ? 'critical' : r.score < 50 ? 'high' : r.score < 75 ? 'medium' : 'low'
      await supabase.from('debts').update({ priority: newPriority }).eq('id', debt.id)
      results.scored++
    } catch (e) {
      log.error(`rescore failed for debt ${debt.id}`, e)
      results.failed++
    }
  }

  log.info('rescore-all run', results)
  return NextResponse.json({ message: 'done', results })
}
