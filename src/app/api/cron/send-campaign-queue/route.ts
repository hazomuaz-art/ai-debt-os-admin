import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { generateCampaignMessage } from '@/lib/campaign-message'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/send-campaign-queue')

// Drains `campaign_send_queue` (built by /api/campaign-builder) and actually
// sends the WhatsApp messages — this was the missing piece that made the
// Campaigns page unable to "run" anything beyond a draft. Respects each
// portfolio number's daily_limit (sent_today resets automatically once
// last_sent_at rolls to a new calendar day) and the campaign's own
// send_window_start/end if set. One batch per run; the crontab interval
// controls overall throughput.
const BATCH_SIZE = 20

function withinSendWindow(start: string | null, end: string | null): boolean {
  if (!start || !end) return true
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
  return hhmm >= start && hhmm <= end
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.APP_SECRET}` && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const nowIso = new Date().toISOString()
  const today = nowIso.slice(0, 10)

  // Recover rows a prior run atomically claimed ('processing') but never
  // completed — e.g. the process was killed mid-send. Without this they'd
  // stay 'processing' and never retry. Only rows claimed more than 10
  // minutes ago are reset (a real in-flight send finishes in seconds), so
  // this never races an active run. processed_at doubles as the claim time.
  const staleIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { error: recoverErr } = await supabase
    .from('campaign_send_queue')
    .update({ status: 'pending' })
    .eq('status', 'processing')
    .lt('processed_at', staleIso)
  if (recoverErr) log.error('failed to recover stale processing rows', new Error(recoverErr.message))

  const { data: queueRows, error } = await supabase
    .from('campaign_send_queue')
    .select(`
      id, company_id, campaign_id, recipient_id, customer_id, debt_id, message_text, attempts, max_attempts,
      campaign:campaigns(id, campaign_type, message_template, sent_count, send_window_start, send_window_end),
      customer:customers(phone, whatsapp),
      whatsapp_number:portfolio_whatsapp_numbers(id, instance_name, api_url, daily_limit, sent_today, last_sent_at, is_active)
    `)
    .eq('status', 'pending')
    .lte('scheduled_at', nowIso)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    log.error('Failed to fetch campaign send queue', error)
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 })
  }

  const results = { sent: 0, failed: 0, skipped_limit: 0, skipped_inactive: 0, skipped_window: 0 }
  const sentCountDelta: Record<string, number> = {}
  // Real bug this fixes: `num.sent_today` is read ONCE per row from the
  // initial batch select — if two queue rows in the same BATCH_SIZE=20
  // batch share the same WhatsApp number, both evaluated the daily_limit
  // check against the same stale pre-batch count and could both pass even
  // though the first send should have already pushed the number over its
  // cap. Track the running count in-memory per number, seeded from the
  // real DB value, and increment it immediately after each successful send
  // within this same loop.
  const runningSentToday: Record<string, number> = {}

  for (const row of queueRows ?? []) {
    const r = row as any
    const num = r.whatsapp_number
    const campaign = r.campaign

    if (!num || !num.is_active) {
      results.skipped_inactive++
      const { error: inactiveErr } = await supabase.from('campaign_send_queue').update({ status: 'failed', error: 'whatsapp_number_inactive_or_missing', processed_at: new Date().toISOString() }).eq('id', r.id)
      if (inactiveErr) log.error('failed to mark queue row failed (inactive number)', new Error(inactiveErr.message), { queue_id: r.id })
      continue
    }
    if (!withinSendWindow(campaign?.send_window_start ?? null, campaign?.send_window_end ?? null)) {
      results.skipped_window++
      continue // leave pending — will be picked up in the next run, in-window
    }

    if (!(num.id in runningSentToday)) {
      const lastSentDay = num.last_sent_at ? String(num.last_sent_at).slice(0, 10) : null
      runningSentToday[num.id] = lastSentDay === today ? (num.sent_today ?? 0) : 0
    }
    const sentTodaySoFar = runningSentToday[num.id]
    // A null/unset daily_limit used to be treated as 0 (0 >= 0 is always
    // true), which silently blocked EVERY send for that number forever —
    // looking identical to "working as intended, just idle". A configured
    // limit is still honored exactly; only a genuinely unset one falls back
    // to a conservative default instead of a de-facto permanent block.
    const effectiveLimit = num.daily_limit ?? 200
    if (sentTodaySoFar >= effectiveLimit) {
      results.skipped_limit++
      continue // leave pending — retried once the daily window resets
    }

    // 🔴 ATOMIC CLAIM — the fix for a real production double-send: this cron
    // did a plain SELECT of pending rows then sent them, with no claim. If a
    // second run (e.g. the scheduled cron overlapping a manual trigger, or
    // two overlapping scheduled runs) started before the first marked a row
    // 'sent', BOTH selected the same pending row and BOTH sent it — the same
    // customer received the identical campaign message twice, seconds apart.
    // Confirmed live: two customers got duplicate messages with distinct
    // whatsapp_message_ids. This UPDATE ... WHERE status='pending' is atomic
    // at the row level in Postgres, so exactly one concurrent run flips
    // pending→processing and proceeds; every other run gets 0 rows back and
    // skips. Placed AFTER the cheap skip checks above (which legitimately
    // leave a row 'pending' for a later run) and BEFORE any send/LLM work.
    const { data: claimed, error: claimErr } = await supabase
      .from('campaign_send_queue')
      .update({ status: 'processing', processed_at: new Date().toISOString() })
      .eq('id', r.id).eq('status', 'pending')
      .select('id')
    if (claimErr) { log.error('failed to claim queue row', new Error(claimErr.message), { queue_id: r.id }); continue }
    if (!claimed || claimed.length === 0) continue // another concurrent run already claimed/sent this row

    const phone = r.customer?.whatsapp || r.customer?.phone
    // Personalized per-customer message generated fresh at send time (real
    // balance, AI score, latest case note) — only falls back to the campaign's
    // generic template if generation is unavailable/fails, or a message_text
    // was already explicitly set on this row.
    let messageText = r.message_text || null
    if (!messageText && campaign) {
      // Same repetition risk as the proactive-reminder fix — a customer
      // enrolled in more than one campaign could otherwise get near-identical
      // AI text each time. Prior campaign messages give the model something
      // concrete to differentiate against.
      const { data: priorCampaignMsgs } = await supabase
        .from('messages').select('content')
        .eq('customer_id', r.customer_id).eq('direction', 'outbound')
        .eq('metadata->>action_type', 'campaign')
        .order('sent_at', { ascending: false }).limit(5)
      messageText = await generateCampaignMessage({
        company_id: r.company_id, customer_id: r.customer_id, debt_id: r.debt_id,
        campaign_type: campaign.campaign_type, message_template: campaign.message_template,
        avoid_texts: (priorCampaignMsgs ?? []).map((m: { content: string | null }) => m.content ?? '').filter(Boolean),
      })
    }
    if (!phone || !messageText) {
      results.failed++
      const { error: noPhoneErr } = await supabase.from('campaign_send_queue').update({ status: 'failed', error: !phone ? 'no_phone' : 'no_message_text', processed_at: new Date().toISOString() }).eq('id', r.id)
      if (noPhoneErr) log.error('failed to mark queue row failed (no phone/text)', new Error(noPhoneErr.message), { queue_id: r.id })
      continue
    }

    const sendResult = await sendWhatsAppMessage({
      to: phone, message: messageText, company_id: r.company_id,
      waha_session: num.instance_name, waha_api_url: num.api_url,
      customer_id: r.customer_id,
    })

    const { error: campaignMsgErr } = await supabase.from('messages').insert({
      company_id: r.company_id, customer_id: r.customer_id, debt_id: r.debt_id,
      channel: 'whatsapp', direction: 'outbound', content: messageText,
      status: sendResult.status === 'sent' ? 'sent' : 'failed',
      whatsapp_message_id: sendResult.message_id || null,
      metadata: { sender: 'ai', action_type: 'campaign', source: 'campaign_send_queue', campaign_id: r.campaign_id, error: sendResult.error ?? null },
      sent_at: new Date().toISOString(),
    })
    if (campaignMsgErr) log.error('campaign message log failed', new Error(campaignMsgErr.message), { queue_id: r.id })

    if (sendResult.status === 'sent') {
      runningSentToday[num.id] = sentTodaySoFar + 1
      // Real gap found during a full-system audit: none of these three
      // writes were checked. A rejected 'sent' status update is the most
      // consequential — the queue row stays 'pending' forever and gets
      // re-sent to the same customer on the next cron run (duplicate
      // messages), since nothing else here marks it done.
      const { error: sentStatusErr } = await supabase.from('campaign_send_queue').update({ status: 'sent', processed_at: new Date().toISOString() }).eq('id', r.id)
      if (sentStatusErr) log.error('failed to mark queue row sent — will be re-sent next run', new Error(sentStatusErr.message), { queue_id: r.id })
      // Real gap found during a full-system audit: this never synced back to
      // campaign_recipients — the campaigns dashboard's target drill-down
      // kept showing "queued" for a recipient whose message had actually
      // already sent, since campaign_send_queue is what actually gates
      // delivery but campaign_recipients.status is the display source.
      if (r.recipient_id) {
        const { error: recipientStatusErr } = await supabase.from('campaign_recipients').update({
          status: 'sent', sent_at: new Date().toISOString(),
        }).eq('id', r.recipient_id)
        if (recipientStatusErr) log.error('failed to sync campaign_recipients status to sent', new Error(recipientStatusErr.message), { recipient_id: r.recipient_id })
      }
      const { error: numberCountErr } = await supabase.from('portfolio_whatsapp_numbers').update({
        sent_today: runningSentToday[num.id], last_sent_at: new Date().toISOString(),
      }).eq('id', num.id)
      if (numberCountErr) log.error('failed to update portfolio number send count', new Error(numberCountErr.message), { number_id: num.id })
      sentCountDelta[r.campaign_id] = (sentCountDelta[r.campaign_id] ?? 0) + 1
      results.sent++
    } else {
      const attempts = (r.attempts ?? 0) + 1
      const maxAttempts = r.max_attempts ?? 3
      const { error: failStatusErr } = await supabase.from('campaign_send_queue').update({
        status: attempts >= maxAttempts ? 'failed' : 'pending',
        attempts, error: sendResult.error ?? 'send_failed', processed_at: new Date().toISOString(),
      }).eq('id', r.id)
      if (failStatusErr) log.error('failed to update queue row after failed send', new Error(failStatusErr.message), { queue_id: r.id })
      results.failed++
    }
  }

  for (const [campaignId, delta] of Object.entries(sentCountDelta)) {
    const { data: c } = await supabase.from('campaigns').select('sent_count, status, started_at').eq('id', campaignId).maybeSingle()
    const wasScheduled = (c as any)?.status === 'scheduled'
    // `started_at: undefined` relied on supabase-js/JSON.stringify silently
    // dropping the key when the campaign wasn't newly started — fragile
    // (a future serialization change would send an explicit null and stomp
    // the real started_at on every later update). Only include the key at
    // all when it should actually change.
    const { error: campaignProgressErr } = await supabase.from('campaigns').update({
      sent_count: ((c as any)?.sent_count ?? 0) + delta,
      status: wasScheduled ? 'running' : (c as any)?.status,
      ...(wasScheduled ? { started_at: new Date().toISOString() } : {}),
    }).eq('id', campaignId)
    if (campaignProgressErr) log.error('campaign progress update failed', new Error(campaignProgressErr.message), { campaign_id: campaignId })
  }

  return NextResponse.json({ message: 'Finished send-campaign-queue', results })
}
