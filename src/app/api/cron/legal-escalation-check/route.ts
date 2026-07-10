import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { openEscalation, getOpenEscalation, REFUSAL_THRESHOLD } from '@/lib/legal-escalation'
import { COMPANY_IMPORT_PROFILES } from '@/lib/company-import-profiles'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/legal-escalation-check')

// A debt whose customer has explicitly refused to pay (or stalled/evaded)
// 3+ times (REFUSAL_THRESHOLD, shared with the live agent) gets escalated to
// the 'repeated_refusal' type — which switches the agent to a dynamic,
// persuasive "lawyer persona" instead of normal negotiation (see
// generateLawyerPersonaReply in ai-collector-agent.ts). Never opened for
// STC, Saudi Energy, or National Water portfolios.
//
// 🔴 This cron is now only a SLOW SAFETY NET: ai-collector-agent.ts reacts to
// the same 3-refusal threshold LIVE, in the same conversation turn, opening
// the escalation immediately instead of waiting on this cron. This still
// exists to catch a debt whose live write somehow failed (e.g. a transient
// DB error at the moment of the 3rd refusal) — the original 48h delay was
// far too slow to be the PRIMARY mechanism (confirmed live: a customer
// refused 5+ times within one hour with nothing escalating), but is fine
// for a secondary catch-all that only needs to eventually notice.
const DELAY_HOURS = 48

const EXCLUDED_KEYS = ['stc', 'saudi_energy', 'national_water'] as const
const EXCLUDED_ALIASES = new Set(
  COMPANY_IMPORT_PROFILES.filter(p => (EXCLUDED_KEYS as readonly string[]).includes(p.key))
    .flatMap(p => p.aliases.map(a => a.trim().toLowerCase()))
)

export async function GET(req: NextRequest) {
  // Root-cause production-readiness audit finding (2026-07-09): this used
  // to "fail open" - if NEITHER APP_SECRET nor CRON_SECRET was configured
  // (a real, plausible env misconfiguration), the auth check below was
  // skipped entirely and this route ran fully unauthenticated for anyone
  // with the URL. A missing secret is now treated as a server
  // misconfiguration (500), never as "allow everyone".
  if (!process.env.APP_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: no cron secret set' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.APP_SECRET}` && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - DELAY_HOURS * 3600_000).toISOString()

  // metadata->refusal_tracking->>count is stored as a JSON number; compare
  // as text->numeric via the ->> operator cast, scoped to active debts only
  // (settled/written_off/legal debts are irrelevant or already escalated).
  const { data: candidates, error } = await supabase
    .from('debts')
    .select('id, company_id, customer_id, portfolio_id, status, metadata, portfolio:portfolios(name, name_ar)')
    .not('status', 'in', '("settled","written_off","legal")')
    .not('metadata->refusal_tracking', 'is', null)

  if (error) {
    log.error('Failed to fetch refusal-tracked debts', error)
    return NextResponse.json({ error: 'Failed to fetch debts' }, { status: 500 })
  }

  const results = { checked: candidates?.length ?? 0, escalated: 0, skipped_excluded: 0, skipped_threshold: 0 }

  for (const debt of candidates ?? []) {
    const d = debt as any
    const tracking = d.metadata?.refusal_tracking as { count?: number; first_at?: string } | undefined
    if (!tracking?.count || tracking.count < REFUSAL_THRESHOLD) { results.skipped_threshold++; continue }
    if (!tracking.first_at || tracking.first_at > cutoff) { results.skipped_threshold++; continue }

    const portfolioName = String(d.portfolio?.name_ar ?? d.portfolio?.name ?? '').trim().toLowerCase()
    if (portfolioName && EXCLUDED_ALIASES.has(portfolioName)) { results.skipped_excluded++; continue }

    // Idempotency: don't reopen if somehow already escalated for this debt.
    const already = await getOpenEscalation(d.company_id, d.id)
    if (already) continue

    const opened = await openEscalation({
      company_id: d.company_id,
      customer_id: d.customer_id,
      debt_id: d.id,
      portfolio_id: d.portfolio_id,
      escalation_type: 'repeated_refusal',
      reason: `رفض/مماطلة متكررة (${tracking.count} مرات)، أول رفض منذ ${tracking.first_at}`,
    })
    if (opened) {
      results.escalated++
      log.info('repeated_refusal escalation opened', { debt_id: d.id, count: tracking.count })
    }
  }

  return NextResponse.json({ message: 'Finished legal-escalation-check', results })
}
