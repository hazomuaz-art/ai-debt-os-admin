import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { generateCampaignMessage } from '@/lib/campaign-message'
import { canSendUnpromptedMessage, isWhatsAppSessionHealthy, isDeliveryQualityHealthy, getWarmupDailyLimit, jitteredSendDelayMs } from '@/lib/send-gate'
import { insertSystemAlert } from '@/lib/system-alerts'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/send-campaign-queue')

// Drains `campaign_send_queue` (built by /api/campaign-builder) and actually
// sends the WhatsApp messages — this was the missing piece that made the
// Campaigns page unable to "run" anything beyond a draft. Respects each
// portfolio number's daily_limit (sent_today resets automatically once
// last_sent_at rolls to a new calendar day) and the campaign's own
// send_window_start/end if set. One batch per run; the crontab interval
// controls overall throughput.
//
// 🔴 BURST-RATE FIX — root cause of a real WhatsApp ban risk (2026-07-06):
// this number (only 6 days old) was silently blocked by WhatsApp TWICE —
// 2026-06-30 (0% delivery on 11 messages) and again today (25% delivery on
// 149 messages) — both times immediately after a campaign burst. The
// per-recipient `scheduled_at` stagger set at build time (1/minute) never
// actually throttled the real send rate: this cron drained up to BATCH_SIZE
// due rows in a SINGLE invocation with no delay between them beyond WAHA's
// own ~1.5s warm-up ping, so if the cron tick lagged even slightly behind
// the 1/minute schedule, many rows became "due" at once and were blasted
// back-to-back — a burst-of-many-first-contacts-to-a-brand-new-number
// pattern that is exactly WhatsApp's own anti-spam fingerprint. Fixed by
// (a) capping how many real sends one tick can ever attempt, and (b) an
// explicit, enforced delay between consecutive real sends within a tick —
// both independent of how the cron scheduler itself behaves.
const BATCH_SIZE = 5

function withinSendWindow(start: string | null, end: string | null): boolean {
  if (!start || !end) return true
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
  return hhmm >= start && hhmm <= end
}

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

  // 🔴 CIRCUIT BREAKER — root-cause fix for a real production incident
  // (2026-07-06): WhatsApp actually disconnected at 11:30, and the
  // whatsapp-health cron correctly detected and alerted it (11:30 and again
  // at 12:00, "رسائل البوت لا تصل للعملاء"), but nothing here ever consulted
  // that signal — this cron kept attempting all 132 campaign targets every
  // few minutes for over 90 minutes into a KNOWN-broken session, burning an
  // LLM call per attempt and repeatedly writing "campaign message" rows into
  // the conversation history even though delivery was failing every time.
  // From an admin looking at the messages list, that is indistinguishable
  // from "the agent keeps messaging a silent customer". Stop entirely,
  // before spending a single LLM call or WAHA request, whenever the health
  // check already knows the session is down.
  if (!(await isWhatsAppSessionHealthy())) {
    log.warn('WhatsApp session unhealthy — skipping this run entirely, no attempts spent')
    return NextResponse.json({ message: 'Skipped — WhatsApp session unhealthy', results: { sent: 0, failed: 0, skipped_unhealthy_session: true } })
  }

  // 🔴 META-POLICY QUALITY GATE — this number was silently blocked by
  // WhatsApp TWICE (2026-06-30 and 2026-07-06), both times because delivery
  // quality had already degraded well before the slower external
  // whatsapp-health cron (30-min cadence) caught it. Check the campaign's
  // OWN recent delivery ratio inline, every single run, independent of that
  // cron's timing. If it's already degrading, PAUSE every affected running
  // campaign outright (not just skip a row) and stop this run completely —
  // mirrors how a real WhatsApp Business quality-rating drop restricts
  // sending until it recovers, rather than quietly limping along.
  const quality = await isDeliveryQualityHealthy()
  if (!quality.healthy) {
    log.warn('delivery quality degraded — pausing running campaigns and skipping this run', quality)
    const pauseSupabase = createServiceClient()
    const { data: runningCampaigns } = await pauseSupabase.from('campaigns').select('id').eq('status', 'running')
    for (const c of (runningCampaigns ?? []) as { id: string }[]) {
      const { error: pauseErr } = await pauseSupabase.from('campaigns').update({ status: 'paused' }).eq('id', c.id)
      if (pauseErr) log.error('failed to auto-pause campaign on quality degradation', new Error(pauseErr.message), { campaign_id: c.id })
    }
    await insertSystemAlert({
      company_id: null, severity: 'critical', alert_type: 'campaign_auto_paused_quality',
      title: 'إيقاف تلقائي للحملة — جودة تسليم متدهورة',
      message: `من أصل ${quality.total} رسالة حملة في آخر ساعة، وصل ${quality.delivered} فقط (${Math.round(quality.ratio * 100)}%). تم إيقاف كل الحملات الجارية تلقائياً قبل أن يتفاقم الحظر الصامت. راجع حالة الرقم قبل الاستئناف يدوياً.`,
      metadata: { total: quality.total, delivered: quality.delivered, ratio: quality.ratio },
    })
    return NextResponse.json({ message: 'Skipped — delivery quality degraded, running campaigns auto-paused', results: { sent: 0, failed: 0, quality } })
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

  const results = { sent: 0, failed: 0, skipped_limit: 0, skipped_inactive: 0, skipped_window: 0, skipped_gate: 0 }
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
    //
    // 🔴 META WARM-UP TIER — the configured daily_limit (250, coincidentally
    // matching WhatsApp Business API's own real Tier-1 cap) is the CEILING,
    // not the actual allowance for a number this fresh. This number has two
    // silent-block incidents in its first 6 days — real Meta policy would
    // have already downgraded its quality rating and restricted it further.
    // Ramp up gradually instead of trusting the static config from day one.
    const warmupLimit = await getWarmupDailyLimit(num.id, num.daily_limit ?? 200)
    const effectiveLimit = Math.min(num.daily_limit ?? 200, warmupLimit)
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

    // 🔴 DECISION ENGINE — the master rule, enforced independently of every
    // other mechanism above: a customer who has not replied gets exactly one
    // unprompted message, then silence, until they reply or 3 full days
    // pass. This does not trust the queue's own attempt bookkeeping (which
    // is exactly what broke in production) — it reads the real, authoritative
    // messages table fresh, right before dispatch, every single time.
    const gate = await canSendUnpromptedMessage(r.customer_id)
    if (!gate.allowed) {
      const { error: skipErr } = await supabase.from('campaign_send_queue').update({
        status: 'skipped', error: gate.reason, processed_at: new Date().toISOString(),
      }).eq('id', r.id)
      if (skipErr) log.error('failed to mark queue row skipped (send-gate)', new Error(skipErr.message), { queue_id: r.id })
      results.skipped_gate++
      continue
    }

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

    // Enforced pacing — see BURST-RATE FIX above. Applied right after every
    // real send attempt (success or failure both still hit WhatsApp's own
    // rate-limit tracking), so no code path through this loop can ever emit
    // two real sends closer together than this floor, regardless of how
    // many rows were due or how the cron scheduler itself behaves. Jittered
    // (not a fixed interval) — a perfectly uniform gap is itself a bot
    // fingerprint; real usage has natural variance.
    await new Promise(resolve => setTimeout(resolve, jitteredSendDelayMs()))

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
      // 🔴 ATOMIC ATTEMPTS INCREMENT — root-cause fix for a real production
      // bug: `attempts = (r.attempts ?? 0) + 1` computed in application code
      // is a read-modify-write race. Confirmed live: one customer had 5
      // "campaign" message rows logged against a queue row whose FINAL
      // attempts value was only 3 — meaning at least one increment was lost
      // to a race while a real send (and a real WAHA request) still
      // happened each time. A single Postgres statement can't lose an
      // update no matter how many callers race on the same row.
      const { data: incResult, error: incErr } = await supabase
        .rpc('increment_campaign_queue_attempts', { p_id: r.id, p_error: sendResult.error ?? 'send_failed' })
      if (incErr) log.error('failed to atomically increment queue row attempts', new Error(incErr.message), { queue_id: r.id })
      void incResult
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
