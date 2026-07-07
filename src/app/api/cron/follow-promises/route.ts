import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateProactiveReminder } from '@/lib/ai-whatsapp-reply'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { isRepeated } from '@/lib/ai-collector-agent'
import { isWhatsAppSessionHealthy, canSendUnpromptedMessage, jitteredSendDelayMs } from '@/lib/send-gate'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/follow-promises')

export async function GET(req: NextRequest) {
  // Simple basic security: verify authorization header
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.APP_SECRET}` && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Circuit breaker — same production incident as send-campaign-queue: don't
  // spend an LLM call and a WAHA request per customer when the health check
  // already knows the session is down.
  if (!(await isWhatsAppSessionHealthy())) {
    log.warn('WhatsApp session unhealthy — skipping this run entirely')
    return NextResponse.json({ message: 'Skipped — WhatsApp session unhealthy' })
  }

  const supabase = createServiceClient()

  // Find promises due today or earlier that are still 'pending'
  const today = new Date().toISOString()
  
  const { data: duePromises, error } = await supabase
    .from('promises')
    .select('*, debts(*, customers(*))')
    .eq('status', 'pending')
    .lte('promised_date', today)

  if (error) {
    log.error('Failed to fetch due promises', error)
    return NextResponse.json({ error: 'Failed to fetch promises' }, { status: 500 })
  }

  if (!duePromises?.length) {
    return NextResponse.json({ message: 'No due promises found.' })
  }

  const results = { sent: 0, failed: 0, broken: 0 }

  for (const promise of duePromises) {
    const debt = promise.debts
    const customer = debt?.customers
    if (!debt || !customer) continue

    const phone = customer.whatsapp || customer.phone
    if (!phone) continue

    // Idempotency guard: don't send a second reminder for the same promise
    // within the same day (e.g. if the cron is triggered twice, or a manual
    // run overlaps the scheduled one).
    const sinceIso = new Date(Date.now() - 20 * 3600_000).toISOString()
    const { data: alreadyReminded } = await supabase
      .from('messages').select('id')
      .eq('debt_id', debt.id).eq('direction', 'outbound')
      .eq('metadata->>source', 'promise_followup')
      .eq('metadata->>promise_id', promise.id)
      .gte('created_at', sinceIso)
      .limit(1).maybeSingle()
    if (alreadyReminded) { log.info('reminder already sent for this promise today — skipping', { promise_id: promise.id }); continue }

    // Real production case that caused genuine customer confusion (confirmed
    // via a real STC conversation): a customer with an UNDECIDED installment
    // request open on the same debt later gave a vague timing signal
    // ("الشهر الجاي") with no amount — the system recorded a promise
    // defaulting to the FULL balance (the only sane default when no partial
    // amount is given), then this cron confidently reminded them "you
    // promised 880,001 SAR" — a number they never actually agreed to while
    // their smaller installment request was still pending review. Skip the
    // confident reminder entirely while a decision is still pending on this
    // debt; the human reviewing the approval will follow up appropriately.
    const { data: pendingApproval } = await supabase
      .from('approvals').select('id')
      .eq('entity_type', 'debt').eq('entity_id', debt.id).eq('status', 'pending')
      .limit(1).maybeSingle()
    if (pendingApproval) {
      log.info('skipping promise reminder — an approval is still pending on this debt', { promise_id: promise.id, debt_id: debt.id })
      continue
    }

    // Same Decision Engine gate as send-campaign-queue — this cron was found
    // during a full-system audit to be checking only session health, not the
    // per-customer rule (one unprompted message, then silence, until reply or
    // 3 days). Without this, a customer could get a campaign message and a
    // promise reminder back to back from two different crons.
    const gate = await canSendUnpromptedMessage(customer.id)
    if (!gate.allowed) {
      log.info('skipping promise reminder — send-gate blocked', { promise_id: promise.id, reason: gate.reason })
      continue
    }

    try {
      // Real production incident this fixes: generateProactiveReminder is a
      // separate, simpler generator with NO memory of what was already sent
      // — it reliably regenerated near-identical wording to previous
      // reminders (same greeting shape, same info order, same closing
      // question) since it ran on the exact same debt/customer summary every
      // day a promise stayed overdue. isRepeated()'s literal-similarity check
      // catches near-exact text but not this kind of paraphrased repetition,
      // so a retry-only-after-the-fact approach wasn't reliable. Fetching the
      // debt's recent outbound history UPFRONT and handing it to the model as
      // concrete "don't repeat this" context (not just a blind post-hoc
      // retry) is far more effective at actually varying the wording.
      const { data: priorOutbound } = await supabase
        .from('messages').select('content').eq('debt_id', debt.id).eq('direction', 'outbound')
        .order('sent_at', { ascending: false }).limit(5)
      const priorTexts = (priorOutbound ?? []).map((m: { content: string | null }) => m.content ?? '').filter(Boolean)

      let reminderMsg = await generateProactiveReminder({
        company_id: promise.company_id,
        customer_id: customer.id,
        debt_id: debt.id,
        reason: `Customer promised to pay ${promise.promised_amount} on ${promise.promised_date} but payment has not been marked as received. Reach out to follow up.`,
        avoid_texts: priorTexts,
      })

      // Full-history guard as a final backstop against literal/near-literal
      // repeats the avoid_texts context (last 5 only) doesn't cover.
      if (reminderMsg) {
        const { data: fullPriorOutbound } = await supabase
          .from('messages').select('content').eq('debt_id', debt.id).eq('direction', 'outbound')
          .order('sent_at', { ascending: true }).limit(500)
        const fullPriorTexts = (fullPriorOutbound ?? []).map((m: { content: string | null }) => m.content ?? '')
        if (isRepeated(reminderMsg, fullPriorTexts)) {
          log.warn('proactive reminder repeated a prior message — regenerating once', { promise_id: promise.id, debt_id: debt.id })
          const retry = await generateProactiveReminder({
            company_id: promise.company_id,
            customer_id: customer.id,
            debt_id: debt.id,
            reason: `Customer promised to pay ${promise.promised_amount} on ${promise.promised_date} but payment has not been marked as received. IMPORTANT: your first attempt repeated a message already sent to this customer — this time, phrase the reminder differently. Reach out to follow up.`,
            avoid_texts: priorTexts,
          })
          reminderMsg = isRepeated(retry, fullPriorTexts) ? '' : retry
        }
      }

      if (reminderMsg) {
        const sendResult = await sendWhatsAppMessage({
          to: phone,
          message: reminderMsg,
          company_id: promise.company_id,
          customer_id: customer.id,
        })

        // Same jittered anti-fingerprint pacing as send-campaign-queue —
        // this loop had zero delay between real sends.
        await new Promise(resolve => setTimeout(resolve, jitteredSendDelayMs()))

        // Always record the outbound message in the conversation (so it shows in the dashboard),
        // even if delivery failed (status reflects that).
        const { error: reminderInsertErr } = await supabase.from('messages').insert({
          company_id: promise.company_id,
          customer_id: customer.id,
          debt_id: debt.id,
          channel: 'whatsapp',
          direction: 'outbound',
          content: reminderMsg,
          status: sendResult.status === 'sent' ? 'sent' : 'failed',
          whatsapp_message_id: sendResult.message_id || null,
          metadata: { sender: 'ai', action_type: 'reply', source: 'promise_followup', promise_id: promise.id, error: sendResult.error ?? null },
          sent_at: new Date().toISOString(),
        })
        // Real gap found the same day it was written: log.error's 2nd param
        // must be an Error instance — a raw Supabase {error} object gets
        // stringified as the useless "[object Object]" instead of the real
        // message (confirmed live in production error logs). Wrapping in
        // new Error(x.message) everywhere this pattern was used today.
        if (reminderInsertErr) log.error('promise-followup message log failed', new Error(reminderInsertErr.message), { promise_id: promise.id })

        if (sendResult.status === 'sent') {
          // NOTE: this used to update promises.status to 'followed_up', but
          // that value has never been valid against promises_status_check
          // (only pending/kept/broken/rescheduled/partial are allowed) — the
          // update silently failed every single time since this cron
          // shipped. The messages-based idempotency check above (20h lookback
          // on metadata->>promise_id) is what actually prevents re-spamming
          // the same promise same-day; status stays 'pending' on purpose
          // here, since a reminder being sent doesn't change whether the
          // promise itself was kept or broken — see the grace-period check
          // further below for the real resolution of an overdue promise.

          // Log to timeline. 'bot_action' was ALSO not a valid event_type
          // (same constraint as above) — this insert had been failing
          // silently too; 'ai_reply' is the correct, valid fit.
          const { error: reminderTimelineErr } = await supabase.from('timeline_events').insert({
            company_id: promise.company_id,
            debt_id: debt.id,
            event_type: 'ai_reply',
            channel: 'whatsapp',
            summary: 'تم إرسال تذكير تلقائي بالوعد',
            detail: `الرسالة: ${reminderMsg}`,
            occurred_at: new Date().toISOString()
          })
          if (reminderTimelineErr) log.error('promise-followup timeline insert failed', new Error(reminderTimelineErr.message), { promise_id: promise.id })

          results.sent++
        } else {
          results.failed++
        }
      }
    } catch (e) {
      log.error(`Failed to send reminder for promise ${promise.id}`, e)
      results.failed++
    }
  }

  // Real production gap: nothing anywhere ever resolved a promise to
  // 'broken' on its own — only an actual payment ever moved it out of
  // 'pending' (to 'kept'/'partial'). A promise whose date passed with no
  // payment and no reschedule just sat as "pending" forever, even weeks
  // later, making the promises page permanently inaccurate. A grace period
  // (rather than marking broken the instant the date passes) avoids
  // penalizing a customer who pays a day or two late.
  const BROKEN_GRACE_DAYS = 3
  const graceCutoff = new Date(Date.now() - BROKEN_GRACE_DAYS * 86400000).toISOString()
  const { data: overduePromises } = await supabase
    .from('promises').select('id, company_id, customer_id, debt_id')
    .eq('status', 'pending').lte('promised_date', graceCutoff)
  let markedBroken = 0
  for (const p of (overduePromises ?? []) as any[]) {
    const { error: breakErr } = await supabase.from('promises').update({ status: 'broken' }).eq('id', p.id)
    if (breakErr) { log.error('failed to mark overdue promise broken', new Error(breakErr.message), { promise_id: p.id }); continue }
    const { error: brokenTimelineErr } = await supabase.from('timeline_events').insert({
      company_id: p.company_id, customer_id: p.customer_id, debt_id: p.debt_id,
      event_type: 'status_change', channel: 'system', actor_type: 'system',
      summary: 'انتهى موعد الوعد بدون سداد ولا تجديد',
      occurred_at: new Date().toISOString(),
    })
    if (brokenTimelineErr) log.error('broken-promise timeline insert failed', new Error(brokenTimelineErr.message), { promise_id: p.id })
    markedBroken++
  }
  results.broken = markedBroken

  return NextResponse.json({
    message: 'Finished processing promises',
    results 
  })
}
