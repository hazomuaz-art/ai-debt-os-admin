import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { resolveCompanyProfile } from '@/lib/company-import-profiles'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/mark-no-reply')

// Real gap the account owner explicitly flagged: "لم يتم الرد" (no reply)
// can NEVER be triggered by the conversational classifier — that classifier
// only ever runs when an inbound message exists, so "the customer never
// replied at all" can't itself be the input. This is the missing time-based
// mechanism: if the agent's last message on an open debt has gone
// unanswered for NO_REPLY_AFTER_DAYS, mark the company's own "لم يتم الرد"/
// "لم يتم التواصل" category (aiExcluded in debt-status-classifier.ts —
// this cron is the ONLY thing allowed to set it, by design).
const NO_REPLY_AFTER_DAYS = 3
const MAX_PER_RUN = 100

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const cutoff = new Date(Date.now() - NO_REPLY_AFTER_DAYS * 86400000).toISOString()

  const { data: debts } = await supabase
    .from('debts')
    .select('id, company_id, customer_id, original_sub_status, portfolio:portfolios(name)')
    .not('status', 'in', '("settled","written_off")')
    .not('portfolio_id', 'is', null)
    .limit(MAX_PER_RUN)

  const results = { checked: debts?.length ?? 0, marked: 0, skipped_no_category: 0, skipped_already_set: 0, skipped_recent_or_replied: 0, failed: 0 }

  for (const d of (debts ?? []) as any[]) {
    try {
      const portfolioName = d.portfolio?.name ?? null
      const profile = resolveCompanyProfile(portfolioName)
      const noReplyCategory = profile?.outcomeCategories.find(c => c.includes('لم يتم الرد') || c.includes('لم يتم التواصل'))
      if (!profile || !noReplyCategory) { results.skipped_no_category++; continue }

      if (d.original_sub_status === noReplyCategory) { results.skipped_already_set++; continue }

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('direction, sent_at')
        .eq('debt_id', d.id)
        .order('sent_at', { ascending: false })
        .limit(1).maybeSingle()

      if (!lastMsg || lastMsg.direction !== 'outbound' || lastMsg.sent_at > cutoff) {
        results.skipped_recent_or_replied++
        continue
      }

      const meta = profile.outcomeMeta[noReplyCategory]
      const { error: updErr } = await supabase.from('debts').update({
        original_sub_status: noReplyCategory,
        normalized_status: meta?.status ?? d.original_sub_status,
        updated_at: new Date().toISOString(),
      }).eq('id', d.id)
      if (updErr) { log.error('failed to mark debt no-reply', new Error(updErr.message), { debt_id: d.id }); results.failed++; continue }

      const { error: histErr } = await supabase.from('collection_status_history').insert({
        company_id: d.company_id, customer_id: d.customer_id, debt_id: d.id,
        source_system: 'system_no_reply_cron',
        old_status: d.original_sub_status, new_status: noReplyCategory,
        normalized_status: meta?.status ?? null,
        changed_by_name: 'System (no reply timeout)',
        changed_at: new Date().toISOString(),
      })
      if (histErr) log.error('collection_status_history insert failed', new Error(histErr.message), { debt_id: d.id })

      results.marked++
    } catch (e) {
      log.error(`mark-no-reply failed for debt ${d.id}`, e as Error)
      results.failed++
    }
  }

  log.info('mark-no-reply run', results)
  return NextResponse.json({ message: 'done', results })
}
