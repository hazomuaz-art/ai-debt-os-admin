import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { getOpenRouterBalance } from '@/lib/provider-balance'

export async function GET(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { searchParams } = req.nextUrl
      const range = searchParams.get('range') ?? 'month' // today | month | all

      const now       = new Date()
      const todayStr  = now.toISOString().split('T')[0]
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

      // ── Cost log query ───────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = ctx.supabase
        .from('ai_cost_log')
        .select('provider, action_type, portfolio_name, estimated_cost, total_tokens, created_at, success')
        .eq('company_id', ctx.profile.company_id)
        .order('created_at', { ascending: false })

      if (range === 'today') {
        q = q.gte('created_at', `${todayStr}T00:00:00Z`)
      } else if (range === 'month') {
        q = q.gte('created_at', monthStart)
      }

      const { data: rows, error } = await q.limit(2000)
      if (error) return errors.internal(error.message)

      const entries = (rows ?? []) as Array<{
        provider:       string
        action_type:    string
        portfolio_name: string | null
        estimated_cost: number
        total_tokens:   number
        created_at:     string
        success:        boolean
      }>

      // ── Aggregations ─────────────────────────────────────────────────

      const totalCost    = entries.reduce((s, r) => s + Number(r.estimated_cost ?? 0), 0)
      const totalTokens  = entries.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0)
      const totalOps     = entries.length
      const failedOps    = entries.filter(r => !r.success).length

      // Today filter
      const todayEntries = entries.filter(r => r.created_at.startsWith(todayStr))
      const todayCost    = todayEntries.reduce((s, r) => s + Number(r.estimated_cost ?? 0), 0)

      // By provider
      const byProvider: Record<string, { cost: number; ops: number }> = {}
      for (const r of entries) {
        if (!byProvider[r.provider]) byProvider[r.provider] = { cost: 0, ops: 0 }
        byProvider[r.provider].cost += Number(r.estimated_cost ?? 0)
        byProvider[r.provider].ops++
      }

      // By action type
      const byAction: Record<string, { cost: number; ops: number }> = {}
      for (const r of entries) {
        if (!byAction[r.action_type]) byAction[r.action_type] = { cost: 0, ops: 0 }
        byAction[r.action_type].cost += Number(r.estimated_cost ?? 0)
        byAction[r.action_type].ops++
      }

      // By portfolio
      const byPortfolio: Record<string, { cost: number; ops: number }> = {}
      for (const r of entries) {
        const key = r.portfolio_name ?? 'Unassigned'
        if (!byPortfolio[key]) byPortfolio[key] = { cost: 0, ops: 0 }
        byPortfolio[key].cost += Number(r.estimated_cost ?? 0)
        byPortfolio[key].ops++
      }

      // Daily trend (last 30 days)
      const dailyMap: Record<string, number> = {}
      for (const r of entries) {
        const day = r.created_at.split('T')[0]
        dailyMap[day] = (dailyMap[day] ?? 0) + Number(r.estimated_cost ?? 0)
      }
      const dailyTrend = Object.entries(dailyMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30)
        .map(([date, cost]) => ({ date, cost }))

      const balance = await getOpenRouterBalance()

      return NextResponse.json({
        data: {
          summary: { totalCost, todayCost, totalTokens, totalOps, failedOps },
          providerBalance: balance,
          byProvider:  Object.entries(byProvider).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost),
          byAction:    Object.entries(byAction).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost),
          byPortfolio: Object.entries(byPortfolio).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.cost - a.cost),
          dailyTrend,
          recent:      entries.slice(0, 50),
        },
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
