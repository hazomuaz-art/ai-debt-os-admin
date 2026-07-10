import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { classifyDebtOutcome } from '@/lib/debt-status-classifier'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/reclassify-outcomes')

// Reconciliation loop for outcome classifications — the systemic guarantee
// the account owner asked for after real misclassifications were found in
// production: "any fix must apply to ALL customers, continuously, in sync
// with the latest events — never a per-customer patch."
//
// The live webhook path classifies each inbound message as it arrives, but
// two failure modes leave a debt showing a status that contradicts what the
// customer actually said:
//   1. Historical: classifications made before a classifier bug was fixed
//      (e.g. the lost-opener-context bug) stay wrong forever if the
//      customer never messages again.
//   2. Missed events: if the webhook path errors/times out on a turn, that
//      turn's classification silently never happens.
// This cron heals both: any debt whose LATEST INBOUND message is newer than
// its last recorded status change gets re-classified with the full fixed
// context (case note + customer-scoped history). It never touches debts
// whose classification is already newer than the last customer message —
// so it converges to a no-op when everything is in sync.
const LOOKBACK_DAYS = 14
const MAX_LLM_PER_RUN = 30

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
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()

  // Latest inbound message per debt within the lookback window.
  const { data: recentInbound, error: msgErr } = await supabase
    .from('messages')
    .select('debt_id, customer_id, content, sent_at')
    .eq('direction', 'inbound')
    .not('debt_id', 'is', null)
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: false })
    .limit(1000)
  if (msgErr) {
    log.error('failed to fetch recent inbound messages', new Error(msgErr.message))
    return NextResponse.json({ error: 'fetch failed' }, { status: 500 })
  }

  const latestByDebt = new Map<string, { customer_id: string; content: string; sent_at: string }>()
  for (const m of (recentInbound ?? []) as any[]) {
    if (m.debt_id && !latestByDebt.has(m.debt_id)) {
      latestByDebt.set(m.debt_id, { customer_id: m.customer_id, content: String(m.content ?? ''), sent_at: m.sent_at })
    }
  }

  const results = { scanned: latestByDebt.size, reclassified: 0, unchanged: 0, skipped_fresh: 0, skipped_no_profile: 0, skipped_null: 0, failed: 0 }
  let llmCalls = 0

  for (const [debtId, lastInbound] of latestByDebt) {
    if (llmCalls >= MAX_LLM_PER_RUN) break
    try {
      // Staleness gate: only re-classify when the customer said something
      // AFTER the last recorded status change — otherwise the current
      // classification already reflects (or postdates) their latest word.
      const { data: lastChange } = await supabase
        .from('collection_status_history')
        .select('changed_at')
        .eq('debt_id', debtId)
        .order('changed_at', { ascending: false })
        .limit(1).maybeSingle()
      if (lastChange && String(lastChange.changed_at) >= lastInbound.sent_at) {
        results.skipped_fresh++
        continue
      }

      const { data: debt } = await supabase
        .from('debts')
        .select('id, company_id, customer_id, status, original_sub_status, portfolio:portfolios(name)')
        .eq('id', debtId)
        .maybeSingle()
      if (!debt) { results.failed++; continue }

      const portfolioName = (debt as any).portfolio?.name ?? null
      if (!portfolioName) { results.skipped_no_profile++; continue }
      if (!lastInbound.content.trim()) { results.skipped_null++; continue }

      llmCalls++
      const outcome = await classifyDebtOutcome({
        portfolio_name: portfolioName,
        customer_message: lastInbound.content,
        debt_id: debtId,
        customer_id: lastInbound.customer_id,
      })

      // null = the model found no clear, definitive classification in the
      // customer's latest message — never overwrite an existing status with
      // a guess; leave it for a human or a clearer future message.
      if (!outcome) { results.skipped_null++; continue }
      if (outcome.category === (debt as any).original_sub_status) { results.unchanged++; continue }

      const { category, meta } = outcome
      const oldStatus = (debt as any).status ?? null

      const { error: updErr } = await supabase.from('debts').update({
        original_sub_status: category,
        normalized_status: meta.status ?? oldStatus,
        ...(meta.status ? { status: meta.status } : {}),
        updated_at: new Date().toISOString(),
      }).eq('id', debtId)
      if (updErr) { log.error('reclassify debt update failed', new Error(updErr.message), { debt_id: debtId, category }); results.failed++; continue }

      const { error: histErr } = await supabase.from('collection_status_history').insert({
        company_id: (debt as any).company_id, customer_id: (debt as any).customer_id, debt_id: debtId,
        source_system: 'ai_agent_reclassify',
        old_status: (debt as any).original_sub_status ?? oldStatus, new_status: category,
        normalized_status: meta.status,
        changed_by_name: 'AI Agent (مزامنة تلقائية)',
        raw_payload: { customer_message: lastInbound.content, reason: 'reconciliation_cron' },
        changed_at: new Date().toISOString(),
      })
      if (histErr) log.error('reclassify status history insert failed', new Error(histErr.message), { debt_id: debtId })

      const { error: tlErr } = await supabase.from('timeline_events').insert({
        company_id: (debt as any).company_id, customer_id: (debt as any).customer_id, debt_id: debtId,
        event_type: 'status_change', channel: 'system', actor_type: 'ai', ai_used: true,
        summary: `تصنيف الحالة (مزامنة): ${category}`,
        detail: meta.meaning, occurred_at: new Date().toISOString(),
      })
      if (tlErr) log.error('reclassify timeline insert failed', new Error(tlErr.message), { debt_id: debtId })

      // Terminal categories (deceased/imprisoned/...) must stop AI replies —
      // exactly the same rule the live webhook path enforces.
      if (meta.isTerminal) {
        const { error: pauseErr } = await supabase.from('customers').update({ ai_paused: true }).eq('id', (debt as any).customer_id)
        if (pauseErr) log.error('reclassify terminal ai_paused update failed', new Error(pauseErr.message), { customer_id: (debt as any).customer_id })
      }

      results.reclassified++
    } catch (e) {
      log.error(`reclassify failed for debt ${debtId}`, e as Error)
      results.failed++
    }
  }

  log.info('reclassify-outcomes run', { ...results, llm_calls: llmCalls })
  return NextResponse.json({ message: 'done', results })
}
