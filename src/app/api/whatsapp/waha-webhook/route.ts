import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone, sendWhatsAppMessage } from '@/lib/whatsapp'
import { processInboundReceipt } from '@/lib/payment-receipt'
import { createLogger } from '@/lib/logger'

const log = createLogger('webhook/waha')

const WAHA_URL = process.env.WAHA_API_URL
const WAHA_KEY = process.env.WAHA_API_KEY

// Customer typed a payment claim directly (no attachment) — e.g. pasted a
// bank confirmation text. Requires a payment keyword AND a number to avoid
// matching casual chat like "بدفع لك بكرة".
const PAYMENT_TEXT_RE = /سددت|دفعت|حولت|ايصال|إيصال|paid|receipt|transfer/i
function looksLikeTextReceipt(text: string): boolean {
  return PAYMENT_TEXT_RE.test(text) && /\d{2,}/.test(text)
}

// WAHA returns media URLs with its INTERNAL base (e.g. http://localhost:3000)
// which is NOT reachable from this app process — every receipt download was
// failing with "fetch failed". Rewrite the origin to the configured WAHA base
// (WAHA_API_URL) while keeping the file path, so downloads actually work.
function wahaMediaUrl(url: string): string {
  if (!url || !WAHA_URL) return url
  try {
    const u = new URL(url)
    const base = new URL(WAHA_URL)
    u.protocol = base.protocol
    u.host = base.host
    return u.toString()
  } catch {
    return url
  }
}

async function downloadMediaBase64(url: string): Promise<string | null> {
  try {
    const r = await fetch(wahaMediaUrl(url), { headers: { 'X-Api-Key': WAHA_KEY ?? '' } })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    return buf.toString('base64')
  } catch {
    return null
  }
}

// WAHA addresses LID-migrated contacts by "<id>@lid". Resolve it to the real
// phone number so we can match the customer (stored by phone in our DB).
async function resolvePhone(from: string, session: string): Promise<string> {
  const [user, server] = from.split('@')
  if (server !== 'lid') return normalizePhone(user)
  try {
    const r = await fetch(`${WAHA_URL!.replace(/\/$/, '')}/api/${session}/lids/${user}`, {
      headers: { 'X-Api-Key': WAHA_KEY ?? '' },
    })
    const j = await r.json().catch(() => ({} as any))
    const pn = String(j?.pn ?? '').split('@')[0]
    return pn ? normalizePhone(pn) : ''
  } catch {
    return ''
  }
}

const ackToStatus: Record<number, string> = { 1: 'sent', 2: 'delivered', 3: 'read', 4: 'read' }

// ── Rapid-fire message burst merging ──
// Root cause of a real production pattern: a customer often sends 2-3
// WhatsApp messages within seconds of each other (e.g. "ماوعدتك انا بشي"
// immediately followed by "انت تستهبل؟"). Without this, EACH message fired
// its own independent runCollectorAgent call instantly — the agent generating
// a reply to message 1 had zero knowledge message 2 even existed yet,
// producing two separate, sometimes contradictory replies seconds apart. A
// human agent reading WhatsApp would naturally wait a beat and read the
// whole burst before replying once. This does the same: buffer per-customer,
// debounce, then run the agent ONCE on the merged text.
// Single PM2 fork-mode process (confirmed in deploy.ps1 — no horizontal
// scaling), so an in-process Map is sufficient; no cross-instance store needed.
const pendingBursts = new Map<string, { texts: string[]; timer: ReturnType<typeof setTimeout>; latestTimestamp: string }>()
const BURST_DEBOUNCE_MS = 6000

function scheduleBurstProcessing(
  customerId: string,
  text: string,
  messageTimestamp: string,
  run: (mergedText: string, latestTimestamp: string) => Promise<void>,
): void {
  let entry = pendingBursts.get(customerId)
  if (entry) {
    clearTimeout(entry.timer)
    entry.texts.push(text)
    entry.latestTimestamp = messageTimestamp
  } else {
    entry = { texts: [text], latestTimestamp: messageTimestamp, timer: null as unknown as ReturnType<typeof setTimeout> }
    pendingBursts.set(customerId, entry)
  }
  // `entry` is the same mutable object stored in the map — the closure below
  // always sees the LATEST texts/timestamp by the time it actually fires,
  // since every new message in the burst mutates this same object in place.
  entry.timer = setTimeout(() => {
    pendingBursts.delete(customerId)
    run(entry!.texts.join('\n'), entry!.latestTimestamp).catch(() => {})
  }, BURST_DEBOUNCE_MS)
}

export async function POST(request: NextRequest) {
  try {
    // Previously unauthenticated — anyone who knew this URL could POST a
    // fake "message" event with any phone number and trigger the AI agent
    // (and its side effects: promises, disputes, payment classification)
    // as if a real customer said it. WAHA's session config now sends a
    // custom header (X-Webhook-Secret) with every webhook call — checked
    // here. Enforced once WAHA_WEBHOOK_SECRET is configured on this app;
    // fails loud while unset rather than silently staying open.
    const expectedSecret = process.env.WAHA_WEBHOOK_SECRET
    if (expectedSecret) {
      if (request.headers.get('x-webhook-secret') !== expectedSecret) {
        log.warn('WAHA webhook rejected — missing/invalid secret')
        return NextResponse.json({ status: 'ok' })
      }
    } else {
      log.error('WAHA_WEBHOOK_SECRET is not set — this webhook is unauthenticated and publicly triggerable')
    }

    const body = await request.json().catch(() => ({} as any))
    const event: string = body?.event ?? ''
    const session: string = body?.session ?? process.env.WAHA_SESSION ?? 'default'
    const payload = body?.payload ?? {}

    const supabase = createServiceClient()

    // ── Delivery acknowledgements ──
    if (event === 'message.ack') {
      // Outbound sends store the FULL serialized id (e.g.
      // "true_<chat>@lid_<ref>"), so match on it directly. We also accept the
      // bare trailing ref as a fallback for any legacy rows stored stripped.
      const msgId = String(payload?.id?._serialized ?? payload?.id ?? '')
      const newStatus = ackToStatus[Number(payload?.ack)]
      if (msgId && newStatus) {
        const ref = msgId.split('_').pop() ?? msgId
        const match = `whatsapp_message_id.eq.${msgId},whatsapp_message_id.eq.${ref}`
        const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 }
        const { data: row } = await supabase
          .from('messages').select('id, status').or(match)
          .eq('direction', 'outbound').limit(1).maybeSingle()
        if (row && (rank[newStatus] ?? 0) > (rank[(row as { status: string }).status] ?? 0)) {
          await supabase.from('messages').update({ status: newStatus }).eq('id', (row as { id: string }).id)
        }
      }
      return NextResponse.json({ status: 'ok' })
    }

    // ── Inbound messages ──
    if (event !== 'message' && event !== 'message.any') return NextResponse.json({ status: 'ok' })
    if (payload?.fromMe) return NextResponse.json({ status: 'ok' })

    const from = String(payload?.from ?? '')
    const text = String(payload?.body ?? '')
    // WAHA sends the message's own send time as a unix-seconds timestamp —
    // used by the Temporal Intelligence Engine's Shadow Mode comparison
    // (relative expressions like "بكرة" must resolve from when the customer
    // actually sent the message, not whenever this webhook happens to run).
    // Never affects the existing decision pipeline — read-only, additive.
    const rawTimestamp = Number(payload?.timestamp)
    const messageTimestamp = Number.isFinite(rawTimestamp) && rawTimestamp > 0
      ? new Date(rawTimestamp * 1000).toISOString()
      : new Date().toISOString()
    const mediaUrl: string = payload?.media?.url ?? ''
    const mimetype: string = String(payload?.media?.mimetype ?? '')
    const hasReceiptMedia = !!mediaUrl && (mimetype.startsWith('image/') || mimetype === 'application/pdf')
    if (from.endsWith('@g.us')) { log.info('group message ignored', { from }); return NextResponse.json({ status: 'ok' }) }
    // Accept the message if it has text OR a receipt-type attachment.
    if (!from || (!text && !hasReceiptMedia)) return NextResponse.json({ status: 'ok' })

    const phone = await resolvePhone(from, session)
    if (!phone) { log.warn('could not resolve phone', { from }); return NextResponse.json({ status: 'ok' }) }

    log.info('WAHA inbound', { from, phone, hasReceiptMedia, mimetype })

    const { data: customer } = await supabase
      .from('customers')
      .select('id, company_id, full_name, ai_paused')
      .or([`whatsapp.eq.${phone}`, `whatsapp.eq.+${phone}`, `phone.eq.${phone}`, `phone.eq.+${phone}`].join(','))
      .limit(1).maybeSingle()

    if (!customer) { log.warn('no customer for inbound', { phone }); return NextResponse.json({ status: 'ok' }) }

    const c = customer as { id: string; company_id: string; full_name?: string; ai_paused?: boolean }
    const msgId = String(payload?.id?._serialized ?? payload?.id ?? '').split('_').pop() ?? null

    // Idempotency guard: WAHA/WhatsApp can redeliver the same webhook event
    // (network retry, duplicate push) — without this check, the agent would
    // run and reply twice for the exact same inbound message.
    if (msgId) {
      const { data: dup } = await supabase
        .from('messages').select('id').eq('whatsapp_message_id', msgId).eq('direction', 'inbound')
        .limit(1).maybeSingle()
      if (dup) { log.info('duplicate inbound webhook ignored', { msgId }); return NextResponse.json({ status: 'ok' }) }
    }

    const { data: latestDebt } = await supabase
      .from('debts').select('id, current_balance, status, portfolio:portfolios(name)').eq('customer_id', c.id)
      .not('status', 'in', '("settled","written_off")')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const debt_id = (latestDebt as { id: string } | null)?.id ?? null

    await supabase.from('messages').insert({
      company_id: c.company_id, customer_id: c.id, debt_id,
      channel: 'whatsapp', direction: 'inbound',
      content: text || (mimetype === 'application/pdf' ? '📎 إيصال (PDF)' : '📎 إيصال (صورة)'),
      status: 'delivered',
      whatsapp_message_id: msgId,
      metadata: { provider: 'waha', from, ...(hasReceiptMedia && { media_url: mediaUrl, mimetype }) },
      sent_at: new Date().toISOString(),
    })

    if (c.ai_paused) { log.info('AI paused — skipping reply', { customer_id: c.id }); return NextResponse.json({ status: 'ok' }) }

    // Payment receipt (image / PDF) → OCR verification pipeline.
    if (hasReceiptMedia) {
      ;(async () => {
        try {
          const r = await fetch(wahaMediaUrl(mediaUrl), { headers: { 'X-Api-Key': WAHA_KEY ?? '' } })
          if (!r.ok) { log.error('receipt media download failed', undefined, { status: r.status }); return }
          const b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
          const { processInboundReceipt } = await import('@/lib/payment-receipt')
          await processInboundReceipt({
            company_id: c.company_id, customer_id: c.id, customer_name: c.full_name,
            debt_id, phone, source: mimetype === 'application/pdf' ? 'pdf' : 'image', data: b64,
          })
        } catch (err) {
          log.error('WAHA receipt processing error', err as Error)
        }
      })().catch(() => {})
      return NextResponse.json({ status: 'ok' })
    }

    // Run the collector agent and reply (sendWhatsAppMessage routes via WAHA).
    // Debounced/merged across a rapid-fire burst — see scheduleBurstProcessing.
    scheduleBurstProcessing(c.id, text, messageTimestamp, async (mergedText, latestTimestamp) => {
      const { runCollectorAgent } = await import('@/lib/ai-collector-agent')
      const { processEvent } = await import('@/lib/automation-pipeline')

      const aiDecision = await runCollectorAgent({
        company_id: c.company_id, customer_id: c.id, debt_id, message: mergedText, messageTimestamp: latestTimestamp,
      })

      // The agent may internally resolve a DIFFERENT debt than the one this
      // webhook picked (multi-portfolio customers) — every side-effect write
      // below must attach to that one, not the webhook's own guess.
      const effectiveDebtId = aiDecision.resolvedDebtId ?? debt_id

      if (aiDecision.shouldReply && aiDecision.message) {
        const waResult = await sendWhatsAppMessage({ to: phone, message: aiDecision.message, company_id: c.company_id })
        await supabase.from('messages').insert({
          company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
          channel: 'whatsapp', direction: 'outbound', content: aiDecision.message,
          status: waResult.status === 'sent' ? 'sent' : 'failed',
          whatsapp_message_id: waResult.message_id || null,
          metadata: { sender: 'ai', action_type: aiDecision.action, provider: 'waha', error: waResult.error },
          sent_at: new Date().toISOString(),
        })
        if (waResult.status === 'sent') {
          await processEvent({
            debt_id: effectiveDebtId ?? 'temp', company_id: c.company_id,
            source: 'ai_reply',
            data: { message: aiDecision.message, action: aiDecision.action },
          }).catch(e => log.error('pipeline failed', e as Error))
        }
      }

      // Dispute → open dispute + approval (dedup), with full context
      if (aiDecision.action === 'record_dispute' && effectiveDebtId) {
        const { recordDispute } = await import('@/lib/dispute')
        await recordDispute({
          company_id: c.company_id, customer_id: c.id, customer_name: c.full_name,
          debt_id: effectiveDebtId, customer_message: mergedText, agent_reason: aiDecision.reason,
        })
      }

      // Installment request → open the SAME approval the dashboard already
      // knows how to notify the customer about on approve/reject (see
      // src/app/api/modules/approvals/route.ts PATCH) — this action was
      // computed by the agent before today but never actually acted on here.
      if (aiDecision.action === 'record_installment_request' && effectiveDebtId) {
        const { recordInstallmentRequest } = await import('@/lib/installment-request')
        await recordInstallmentRequest({
          company_id: c.company_id, customer_id: c.id, customer_name: c.full_name,
          debt_id: effectiveDebtId, customer_message: mergedText, agent_reason: aiDecision.reason,
        })
      }

      // Promise → record ONLY with the date the agent extracted from the
      // customer's own current message (never fabricated).
      if (aiDecision.action === 'record_promise' && effectiveDebtId && aiDecision.promised_date) {
        const { recordPromise } = await import('@/lib/promise')
        await recordPromise({
          company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
          promised_amount: Number((latestDebt as { current_balance?: number } | null)?.current_balance ?? 0),
          promised_date: aiDecision.promised_date, customer_message: mergedText,
          promise_text: aiDecision.promise_text ?? null,
        })
      } else if (aiDecision.action === 'record_promise' && effectiveDebtId && !aiDecision.promised_date) {
        // The agent's internal guards should always force a date before
        // reaching here (see ai-collector-agent.ts's record_promise date
        // validation) — this should never actually fire. But if some
        // unanticipated path ever slips through with no date, the customer
        // may have just been told "your promise is recorded" while nothing
        // gets saved. Never let that be silent — same pattern as the
        // payment-receipt "couldn't read the amount" alert.
        log.error('record_promise with no promised_date — nothing saved, flagging for review', new Error('missing promised_date'), { debt_id: effectiveDebtId })
        await supabase.from('system_alerts').insert({
          company_id: c.company_id, severity: 'warning', alert_type: 'promise_not_recorded',
          title: 'وعد سداد لم يُسجَّل تلقائياً',
          message: `العميل ${c.full_name} قد يكون أُخبر بأن وعده مسجَّل، لكن لم يُستخرج تاريخ صريح من رسالته — راجع المحادثة وسجّل الوعد يدوياً إذا لزم.`,
          metadata: { customer_id: c.id, debt_id: effectiveDebtId, customer_message: mergedText },
          is_resolved: false, created_at: new Date().toISOString(),
        })
      }

      // Company-specific outcome classification (from "تصنيفات جميع
      // الشركات.xlsx") — only runs for the 11 known company profiles;
      // manual/generic portfolios get null and are untouched.
      if (effectiveDebtId) {
        const portfolioName = (latestDebt as { portfolio?: { name?: string } } | null)?.portfolio?.name ?? null
        const { classifyDebtOutcome } = await import('@/lib/debt-status-classifier')
        const outcome = await classifyDebtOutcome({ portfolio_name: portfolioName, customer_message: mergedText })

        if (outcome) {
          const { category, meta } = outcome
          const oldStatus = (latestDebt as { status?: string } | null)?.status ?? null

          await supabase.from('debts').update({
            original_sub_status: category,
            normalized_status: meta.status ?? oldStatus,
            ...(meta.status ? { status: meta.status } : {}),
            updated_at: new Date().toISOString(),
          }).eq('id', effectiveDebtId)

          await supabase.from('collection_status_history').insert({
            company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
            source_system: 'ai_agent',
            old_status: oldStatus, new_status: category,
            normalized_status: meta.status,
            changed_by_name: 'AI Agent',
            raw_payload: { customer_message: mergedText },
            changed_at: new Date().toISOString(),
          })

          await supabase.from('timeline_events').insert({
            company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
            event_type: 'outcome_classified', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
            summary: `تصنيف الحالة: ${category}`,
            detail: meta.meaning, occurred_at: new Date().toISOString(),
          })

          if (meta.isTerminal) {
            await supabase.from('customers').update({ ai_paused: true }).eq('id', c.id)
            await supabase.from('system_alerts').insert({
              company_id: c.company_id, severity: 'high', alert_type: 'outcome_needs_human_review',
              title: `يحتاج مراجعة بشرية: ${category}`,
              message: `العميل ${c.full_name} صُنّف بحالة "${category}" — ${meta.meaning} تم إيقاف الرد التلقائي على هذا العميل.`,
              metadata: { customer_id: c.id, debt_id: effectiveDebtId, category },
              is_resolved: false, created_at: new Date().toISOString(),
            })
          }
        }
      }
    })

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    log.error('WAHA webhook error', err as Error)
    return NextResponse.json({ status: 'ok' })
  }
}
