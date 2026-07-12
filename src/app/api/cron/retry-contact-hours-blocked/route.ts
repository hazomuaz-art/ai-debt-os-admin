import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage, isWithinAllowedContactHours } from '@/lib/whatsapp'
import { isWhatsAppSessionHealthy } from '@/lib/send-gate'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/retry-contact-hours-blocked')

// Real production gap (2026-07-12, owner): every reply the agent generates
// for a customer message that arrives outside allowed contact hours (see
// isWithinAllowedContactHours in lib/whatsapp.ts) is correctly SAVED to the
// conversation (so it's never lost/hidden) but its actual WhatsApp send
// fails with status='failed', error='blocked_contact_hours' — and nothing
// anywhere ever retried it. Confirmed live: a customer who sent 3 messages
// one night got 3 fully-reasoned replies generated, all of which silently
// never reached them; the conversation only continued the next time the
// CUSTOMER happened to message again on their own, leaving every after-hours
// question permanently unanswered otherwise. verify-delivery.ts does NOT
// cover this — it only retries messages stuck at status='sent' (accepted by
// WAHA but never acked), never messages that failed before an attempt was
// even made.
//
// Fix: once contact hours reopen, find every customer whose most recent
// message is still an unanswered inbound (or a blocked_contact_hours failure
// that was never followed by a real send), and generate ONE fresh reply from
// current context — not a blind resend of the stale old text, since by
// morning the situation may have moved on and 2-3 disjointed overnight
// replies landing back-to-back would look exactly like the "robotic, ignores
// context" complaint already fixed once in the legal-persona prompt. Old
// failed rows are marked handled either way so they're never reprocessed.
const MAX_PER_RUN = 20
const MAX_LOOKBACK_HOURS = 48 // don't chase very old blocked sends forever

export async function GET(req: NextRequest) {
  if (!process.env.APP_SECRET && !process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Server misconfigured: no cron secret set' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.APP_SECRET}` && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isWithinAllowedContactHours()) {
    return NextResponse.json({ message: 'Skipped — still outside allowed contact hours', results: { checked: 0 } })
  }
  if (!(await isWhatsAppSessionHealthy())) {
    log.warn('WhatsApp session unhealthy — skipping this run entirely')
    return NextResponse.json({ message: 'Skipped — WhatsApp session unhealthy' })
  }

  const supabase = createServiceClient()
  const results = { checked: 0, replied: 0, already_answered: 0, no_pending_message: 0, failed: 0 }

  const sinceIso = new Date(Date.now() - MAX_LOOKBACK_HOURS * 3600_000).toISOString()
  const { data: blockedRows } = await supabase
    .from('messages')
    .select('id, company_id, customer_id, debt_id, sent_at')
    .eq('direction', 'outbound').eq('channel', 'whatsapp').eq('status', 'failed')
    .eq('metadata->>error', 'blocked_contact_hours')
    .is('metadata->>contact_hours_retry_handled', null)
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: true })
    .limit(500)

  const byCustomer = new Map<string, { company_id: string; debt_id: string | null }>()
  for (const row of (blockedRows ?? []) as { company_id: string; customer_id: string; debt_id: string | null }[]) {
    if (!byCustomer.has(row.customer_id)) byCustomer.set(row.customer_id, { company_id: row.company_id, debt_id: row.debt_id })
  }
  results.checked = byCustomer.size

  for (const [customerId, info] of byCustomer) {
    if (results.replied + results.already_answered + results.no_pending_message + results.failed >= MAX_PER_RUN) break

    try {
      // Always clear the old failed rows for this customer first, regardless
      // of outcome below — they must never be reconsidered by a future run.
      // Fetches each row's existing metadata and merges the flag in, rather
      // than a blanket overwrite — a blind `.update({ metadata: {...} })`
      // would wipe the row's existing `error`/`sender`/`source` fields,
      // erasing exactly the audit trail a human reviewing this failed
      // message later would need.
      const markHandled = async () => {
        const { data: rowsToMark } = await supabase
          .from('messages').select('id, metadata')
          .eq('customer_id', customerId).eq('direction', 'outbound').eq('status', 'failed')
          .eq('metadata->>error', 'blocked_contact_hours').is('metadata->>contact_hours_retry_handled', null)
        for (const row of (rowsToMark ?? []) as { id: string; metadata: Record<string, unknown> | null }[]) {
          const { error } = await supabase.from('messages')
            .update({ metadata: { ...(row.metadata ?? {}), contact_hours_retry_handled: true } })
            .eq('id', row.id)
          if (error) log.error('failed to mark blocked row handled', new Error(error.message), { customer_id: customerId, message_id: row.id })
        }
      }

      const { data: latestMsg } = await supabase
        .from('messages').select('direction, status, sent_at')
        .eq('customer_id', customerId)
        .order('sent_at', { ascending: false }).limit(1).maybeSingle()

      // The customer already got a real, successful reply after the blocked
      // one — most commonly because they messaged again this morning and the
      // normal live pipeline already answered fresh (exactly the July 11
      // production example). Nothing to do.
      if (latestMsg && (latestMsg as any).direction === 'outbound' && ['sent', 'delivered', 'read'].includes((latestMsg as any).status)) {
        await markHandled()
        results.already_answered++
        continue
      }

      // Collect the unanswered inbound turn(s): walk backward from the most
      // recent message, merging consecutive inbound content — same shape as
      // the live webhook's rapid-fire burst merge — until hitting an
      // outbound message (the last point they were actually answered).
      const { data: recentMsgs } = await supabase
        .from('messages').select('direction, content, sent_at')
        .eq('customer_id', customerId)
        .order('sent_at', { ascending: false }).limit(20)

      const unanswered: { content: string; sent_at: string }[] = []
      for (const m of (recentMsgs ?? []) as { direction: string; content: string | null; sent_at: string }[]) {
        if (m.direction !== 'inbound') break
        if (m.content) unanswered.unshift({ content: m.content, sent_at: m.sent_at })
      }

      if (!unanswered.length) {
        // No genuinely pending inbound question found (e.g. the customer's
        // last message before the blocked reply was itself something the
        // agent chose to stay silent on) — nothing to send.
        await markHandled()
        results.no_pending_message++
        continue
      }

      const { data: customer } = await supabase
        .from('customers').select('phone, whatsapp, ai_paused').eq('id', customerId).eq('company_id', info.company_id).maybeSingle()
      const phone = (customer as any)?.phone || (customer as any)?.whatsapp
      if (!customer || (customer as any).ai_paused || !phone) {
        await markHandled()
        results.no_pending_message++
        continue
      }

      const { runCollectorAgent } = await import('@/lib/ai-collector-agent')
      const { processEvent } = await import('@/lib/automation-pipeline')

      const mergedText = unanswered.map(u => u.content).join('\n')
      const latestTimestamp = unanswered[unanswered.length - 1].sent_at

      const aiDecision = await runCollectorAgent({
        company_id: info.company_id, customer_id: customerId, debt_id: info.debt_id,
        message: mergedText, messageTimestamp: latestTimestamp,
      })
      const effectiveDebtId = aiDecision.resolvedDebtId ?? info.debt_id

      if (aiDecision.shouldReply && aiDecision.message) {
        const waResult = await sendWhatsAppMessage({ to: phone, message: aiDecision.message, company_id: info.company_id, customer_id: customerId })
        const { error: insertErr } = await supabase.from('messages').insert({
          company_id: info.company_id, customer_id: customerId, debt_id: effectiveDebtId,
          channel: 'whatsapp', direction: 'outbound', content: aiDecision.message,
          status: waResult.status === 'sent' ? 'sent' : 'failed',
          whatsapp_message_id: waResult.message_id || null,
          metadata: { sender: 'ai', action_type: aiDecision.action, provider: 'waha', source: 'contact_hours_retry', error: waResult.error },
          sent_at: new Date().toISOString(),
        })
        if (insertErr) log.error('retry reply message insert failed', new Error(insertErr.message), { customer_id: customerId })

        if (waResult.status === 'sent') {
          await processEvent({
            debt_id: effectiveDebtId ?? 'temp', company_id: info.company_id,
            source: 'ai_reply',
            data: { message: mergedText, ai_reply: aiDecision.message, action: aiDecision.action },
          }).catch(e => log.error('pipeline failed for contact-hours retry', e as Error, { customer_id: customerId }))
          results.replied++
        } else {
          // Still blocked (e.g. window closed again mid-run) or a real send
          // failure — leave the OLD blocked rows unmarked so a later run can
          // retry properly; the freshly-inserted row here will simply be
          // picked up by the next run's own blocked-row query if its error
          // is also blocked_contact_hours.
          results.failed++
          continue
        }
      } else {
        // Agent deliberately decided not to reply (e.g. the merged text
        // turned out to be a plain goodbye/thanks) — respect that.
        results.no_pending_message++
      }

      await markHandled()
    } catch (e) {
      log.error(`retry-contact-hours-blocked failed for customer ${customerId}`, e as Error)
      results.failed++
    }
  }

  log.info('retry-contact-hours-blocked run', results)
  return NextResponse.json({ message: 'done', results })
}
