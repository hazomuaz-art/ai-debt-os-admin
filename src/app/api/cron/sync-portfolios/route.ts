import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ensurePortfolioForCreditor } from '@/lib/actions/debts'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/sync-portfolios')

// Assigns every debt that has a creditor_name but no portfolio to a portfolio
// named after its creditor (creating the portfolio if needed).
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data: debts } = await supabase
    .from('debts')
    .select('id, company_id, creditor_name, portfolio_id')
    .not('creditor_name', 'is', null)
    .is('portfolio_id', null)
    .limit(1000)

  const results = { total: debts?.length ?? 0, assigned: 0, failed: 0 }
  const cache = new Map<string, string | null>()

  for (const d of debts ?? []) {
    try {
      const key = `${d.company_id}::${d.creditor_name}`
      let pid = cache.get(key)
      if (pid === undefined) {
        pid = await ensurePortfolioForCreditor(supabase, d.company_id, d.creditor_name as string)
        cache.set(key, pid)
      }
      if (pid) {
        await supabase.from('debts').update({ portfolio_id: pid }).eq('id', d.id)
        results.assigned++
      } else { results.failed++ }
    } catch (e) {
      log.error(`portfolio sync failed for debt ${d.id}`, e)
      results.failed++
    }
  }

  log.info('sync-portfolios run', results)
  return NextResponse.json({ message: 'done', results })
}
