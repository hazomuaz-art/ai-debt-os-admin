import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizePhone, sendWhatsAppMessage } from '@/lib/whatsapp'
import { processInboundReceipt } from '@/lib/payment-receipt'
import { insertSystemAlert } from '@/lib/system-alerts'
import { insertTimelineEvent } from '@/lib/timeline'
import { transcribeAudioMessage } from '@/lib/audio-transcription'
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
// Raised from 6s to 9s — a real customer typing several short WhatsApp
// bubbles in a row (thinking between them) commonly spans more than 6
// seconds, and a message arriving just after the old window closed still
// got its own separate, disconnected reply instead of being read as part
// of the same thought.
const BURST_DEBOUNCE_MS = 9000

// Real production bug this fixes: the debounce timer above only MERGES
// messages that arrive within the same 9s window — it never stopped a
// SECOND independent run() from starting for the same customer if the
// FIRST run() (a full classify + LLM-reply + record pipeline; easily
// several seconds, sometimes more under load) was still in flight when a
// later message's own 9s timer fired. Two concurrent runCollectorAgent
// calls for the same customer each fetch conversation history fresh — the
// second call cannot see the first call's not-yet-committed outbound
// reply, so it has no idea a reply is already being sent, and independently
// generates and sends its own. This is the confirmed cause of a customer
// getting a duplicate reply (and, since one of the two concurrent LLM
// calls can end up working from a slightly different context snapshot,
// occasionally an inconsistent/formal-register reply alongside the normal
// Saudi-dialect one). Never processes two turns for the same customer
// concurrently, regardless of how long a turn takes.
const processingCustomers = new Set<string>()
const LOCK_RECHECK_MS = 1500

// Test-only: this Set is module-level (correct for the real single-process
// server, where it must outlive any one request), but that means it isn't
// naturally reset between test cases the way pendingBursts is (that one
// self-clears synchronously inside the timer callback, before run() even
// starts) — exported so test setup can clear it between cases.
export function __resetWahaWebhookStateForTests(): void {
  processingCustomers.clear()
  pendingBursts.clear()
}

function fireWhenFree(customerId: string, run: (mergedText: string, latestTimestamp: string) => Promise<void>): void {
  const entry = pendingBursts.get(customerId)
  if (!entry) return // nothing pending (shouldn't happen, but nothing to run)

  if (processingCustomers.has(customerId)) {
    // A previous turn for this customer outlasted the debounce window —
    // wait and recheck instead of racing it with a second concurrent run.
    entry.timer = setTimeout(() => fireWhenFree(customerId, run), LOCK_RECHECK_MS)
    return
  }

  pendingBursts.delete(customerId)
  processingCustomers.add(customerId)
  // Real bug found in production: this used to be `.catch(() => {})` —
  // any exception ANYWHERE inside `run` (classification, promise/dispute
  // recording, the case-note update at the very end...) silently killed
  // everything after the point of failure for that turn, with zero log
  // trace. This is exactly why a real customer's case note froze at one
  // point in a long conversation and never updated again afterward, even
  // though replies kept sending fine (the send happens before the failure
  // point) — there was no way to even know it had stopped. Always log now.
  run(entry.texts.join('\n'), entry.latestTimestamp)
    .catch(err => {
      log.error('burst-processed run() failed — see which step inside it threw', err as Error, { customerId })
    })
    .finally(() => processingCustomers.delete(customerId))
}

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
  entry.timer = setTimeout(() => fireWhenFree(customerId, run), BURST_DEBOUNCE_MS)
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
    if (!expectedSecret) {
      // Same fail-open bug found and fixed platform-wide (2026-07-01
      // security audit) in email/inbound-webhook and rasf/webhook — this one
      // is currently safe in production because WAHA_WEBHOOK_SECRET IS
      // configured, but hardened to fail CLOSED instead of open for the
      // moment it ever isn't (accidental env var removal/rename), rather
      // than silently reopening the platform's main customer-facing channel.
      log.error('WAHA_WEBHOOK_SECRET is not set — waha webhook is disabled until configured')
      return NextResponse.json({ status: 'service not configured' }, { status: 503 })
    }
    if (request.headers.get('x-webhook-secret') !== expectedSecret) {
      log.warn('WAHA webhook rejected — missing/invalid secret')
      return NextResponse.json({ status: 'ok' })
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
          const { error: ackErr } = await supabase.from('messages').update({ status: newStatus }).eq('id', (row as { id: string }).id)
          if (ackErr) log.warn('delivery status ack update failed', { error: ackErr.message, msgId })
        }
      }
      return NextResponse.json({ status: 'ok' })
    }

    if (event !== 'message' && event !== 'message.any') return NextResponse.json({ status: 'ok' })

    // 🔴 A message sent manually from the PHONE itself (the linked device),
    // not through this system's dashboard/API, also arrives here as
    // fromMe=true — this used to be unconditionally ignored, meaning the
    // agent had ZERO knowledge such a message was ever sent, and could reply
    // inconsistently with what the human already told the customer. Every
    // OUR-OWN send (via sendWhatsAppMessage) is already logged with its real
    // whatsapp_message_id — if a fromMe event's id ISN'T already in our
    // messages table, it must be a genuine manual send from the phone that
    // never went through our system, and gets recorded here so the agent's
    // conversation-history context includes it on the next reply.
    if (payload?.fromMe) {
      const outMsgId = String(payload?.id?._serialized ?? payload?.id ?? '')
      if (!outMsgId) return NextResponse.json({ status: 'ok' })
      const outRef = outMsgId.split('_').pop() ?? outMsgId
      const { data: alreadyLogged } = await supabase
        .from('messages').select('id')
        .or(`whatsapp_message_id.eq.${outMsgId},whatsapp_message_id.eq.${outRef}`)
        .eq('direction', 'outbound').limit(1).maybeSingle()
      if (alreadyLogged) return NextResponse.json({ status: 'ok' }) // our own send, already recorded

      const manualText = String(payload?.body ?? '').trim()
      // `to` identifies the chat/recipient for an outgoing (fromMe) event;
      // logged alongside the raw payload once so the exact WAHA field shape
      // can be confirmed against a real occurrence if this ever misses.
      const toRaw = String(payload?.to ?? payload?.from ?? '')
      const manualPhone = toRaw ? await resolvePhone(toRaw, session) : ''
      if (!manualText || !manualPhone) {
        log.warn('fromMe message not already logged, but missing text/recipient to record it — check payload shape', { hasText: !!manualText, toRaw, payloadKeys: Object.keys(payload ?? {}) })
        return NextResponse.json({ status: 'ok' })
      }

      const { data: manualCustomer } = await supabase
        .from('customers').select('id, company_id')
        .or([`whatsapp.eq.${manualPhone}`, `phone.eq.${manualPhone}`].join(','))
        .limit(1).maybeSingle()
      if (manualCustomer) {
        const mc = manualCustomer as { id: string; company_id: string }
        const { data: manualDebt } = await supabase
          .from('debts').select('id').eq('customer_id', mc.id)
          .not('status', 'in', '("settled","written_off")')
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        const { error: manualInsertErr } = await supabase.from('messages').insert({
          company_id: mc.company_id, customer_id: mc.id, debt_id: (manualDebt as { id: string } | null)?.id ?? null,
          channel: 'whatsapp', direction: 'outbound', content: manualText,
          status: 'sent', whatsapp_message_id: outMsgId,
          metadata: { sender: 'human', source: 'manual_phone_send' },
          sent_at: new Date().toISOString(),
        })
        if (manualInsertErr) log.error('manual phone-sent message log failed', new Error(manualInsertErr.message), { customer_id: mc.id })
        else log.info('manual phone-sent message recorded', { customer_id: mc.id })
      } else {
        log.warn('fromMe message from an unrecognized recipient number — not recorded', { manualPhone })
      }
      return NextResponse.json({ status: 'ok' })
    }

    // ── Inbound messages ──
    const from = String(payload?.from ?? '')
    let text = String(payload?.body ?? '')
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
    // WhatsApp stickers are ALWAYS sent as image/webp — real photos/scans a
    // customer sends are never webp. Without this exclusion, a sticker (a
    // reaction emoji, nothing else) was treated exactly like a receipt photo:
    // routed into the AI document-classifier (which hallucinates a doc_type
    // for a cartoon image), and because stickers never carry caption text,
    // the code below returns before ever invoking the conversational agent
    // — so the agent goes silent, or sends a confusing "received your
    // attachment" ack for what was just an emoji, and a fake "document
    // received" event gets written into the conversation history that
    // poisons the agent's understanding on every later turn.
    const isSticker = mimetype === 'image/webp'
    const hasReceiptMedia = !!mediaUrl && !isSticker && (mimetype.startsWith('image/') || mimetype === 'application/pdf')
    if (from.endsWith('@g.us')) { log.info('group message ignored', { from }); return NextResponse.json({ status: 'ok' }) }
    if (!from) return NextResponse.json({ status: 'ok' })

    // Voice notes — transcribe to text and feed the transcript through the
    // EXACT SAME pipeline as a typed message, so the agent replies to what
    // the customer actually said, not a generic "received your attachment"
    // ack. Real gap this fixes: any non-image/pdf attachment (including
    // voice notes) previously fell straight into "unsupported attachment
    // type" below — logged for staff, but the agent never knew the customer
    // said anything at all.
    let isVoiceNote = false
    if (!text && mediaUrl && mimetype.startsWith('audio/') && !isSticker) {
      isVoiceNote = true
      const b64 = await downloadMediaBase64(mediaUrl)
      const transcript = b64 ? await transcribeAudioMessage(b64, mimetype) : null
      if (transcript) {
        text = transcript
        log.info('voice note transcribed', { from, transcript_preview: transcript.slice(0, 80) })
      } else {
        log.warn('voice note transcription failed — no reply sent', { from, mimetype })
        await insertSystemAlert({
          company_id: null, severity: 'warning', alert_type: 'voice_transcription_failed',
          title: 'تعذّر تحويل رسالة صوتية من عميل',
          message: `أرسل الرقم ${from} رسالة صوتية لم يتمكن النظام من تحويلها لنص — راجعها يدوياً إذا لزم.`,
          metadata: { from, mimetype },
        })
        return NextResponse.json({ status: 'ok' })
      }
    }

    // Accept the message if it has text (including a transcribed voice
    // note) OR a receipt-type attachment.
    if (!text && !hasReceiptMedia) {
      // Real gap found during a full-system audit: an attachment type we
      // don't classify (not image/pdf — e.g. a Word/Excel file, audio note)
      // sent with no caption text used to vanish completely, with zero trace
      // anywhere (no log line, no alert) — indistinguishable from nothing
      // having happened at all. Still nothing to act on automatically (no
      // classifier for arbitrary file types), but now at least visible to
      // staff instead of silently dropped.
      // A sticker with no caption is a harmless reaction, not a real
      // attachment staff need to review — skip it silently, no alert noise.
      if (mediaUrl && !isSticker) {
        log.warn('unsupported inbound attachment type — not stored, no reply sent', { from, mimetype })
        await insertSystemAlert({
          company_id: null, severity: 'warning', alert_type: 'unsupported_attachment_type',
          title: 'مرفق بصيغة غير مدعومة من عميل',
          message: `أرسل الرقم ${from} مرفقاً بصيغة (${mimetype || 'غير معروفة'}) لا يدعمها النظام حالياً للتصنيف — راجعه يدوياً إذا لزم.`,
          metadata: { from, mimetype },
        })
      }
      return NextResponse.json({ status: 'ok' })
    }

    const phone = await resolvePhone(from, session)
    if (!phone) { log.warn('could not resolve phone', { from }); return NextResponse.json({ status: 'ok' }) }

    log.info('WAHA inbound', { from, phone, hasReceiptMedia, mimetype })

    let { data: customer } = await supabase
      .from('customers')
      .select('id, company_id, full_name, ai_paused')
      .or([`whatsapp.eq.${phone}`, `whatsapp.eq.+${phone}`, `phone.eq.${phone}`, `phone.eq.+${phone}`].join(','))
      .limit(1).maybeSingle()

    // Real gap found during a full-system audit: a phone already linked as a
    // SECONDARY contact (customer_contacts — either from a manual/import
    // secondary number or from a prior unknown-caller self-identification
    // below) was never checked here, only the primary phone/whatsapp
    // columns — so a known secondary number still hit the "unmatched" path
    // on every single message forever, never actually resolving.
    if (!customer) {
      const { data: contactRow } = await supabase
        .from('customer_contacts').select('customer_id').eq('phone', phone).limit(1).maybeSingle()
      if (contactRow) {
        const { data: viaContact } = await supabase
          .from('customers').select('id, company_id, full_name, ai_paused')
          .eq('id', (contactRow as { customer_id: string }).customer_id).maybeSingle()
        customer = viaContact
      }
    }

    if (!customer) {
      // Real production gap this replaces: an inbound message from a totally
      // unrecognized phone used to be a dead end — logged and alerted, but
      // the agent never replied and the customer (if real) was left hanging
      // forever. Now asks for something identifying (national ID / account
      // number / invoice-reference number) and searches for an EXACT match
      // before ever disclosing anything — see unknown-caller.ts.
      const { handleUnknownCaller } = await import('@/lib/unknown-caller')
      const result = await handleUnknownCaller({ phone, message: text || '' })

      if (result.reply) {
        // company_id genuinely isn't known yet at this point — omitted on
        // purpose, sendWhatsAppMessage falls back to the shared default WAHA
        // session (this platform runs one shared gateway for inbound; only
        // outbound CAMPAIGNS use a per-portfolio override).
        await sendWhatsAppMessage({ to: phone, message: result.reply })
        return NextResponse.json({ status: 'ok' })
      }

      if (!result.matched) {
        // No candidate found in the message at all (e.g. a media-only or
        // blank turn) and not the first contact — nothing to ask again for
        // this turn; stay silent rather than repeat the same question.
        return NextResponse.json({ status: 'ok' })
      }

      const { data: viaMatch } = await supabase
        .from('customers').select('id, company_id, full_name, ai_paused')
        .eq('id', result.matched.customer_id).maybeSingle()
      customer = viaMatch
      if (!customer) return NextResponse.json({ status: 'ok' })
      log.info('unknown caller resolved to existing customer', { phone, customer_id: result.matched.customer_id })
    }

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

    // Secondary content-based guard: a NOWEB session resync (container
    // restart, VPS reboot, WhatsApp forcing a re-auth, a network blip — not
    // just a deliberate manual restart) can replay recent chat history as
    // fresh "message" webhook events carrying a DIFFERENT internal message
    // id for content already processed — the msgId check above can't catch
    // that since the id genuinely differs. A resync can happen at any time
    // in a long-running production system, so this is intentionally NOT a
    // short time-boxed window (a narrow window only protects against a
    // replay that happens to land within it — a real production incident
    // showed a replay landing 3+ minutes after the original). Instead: does
    // this EXACT text from this SAME customer already exist anywhere among
    // their last 5 inbound messages, regardless of age? A customer
    // genuinely retyping the identical text days apart is rare enough that
    // silently dropping it is the safer failure mode vs. the bot replying
    // twice to a stale replayed message.
    if (text) {
      const { data: recentInbound } = await supabase
        .from('messages').select('content').eq('customer_id', c.id).eq('direction', 'inbound')
        .order('sent_at', { ascending: false }).limit(5)
      const isReplay = (recentInbound ?? []).some((m: { content: string | null }) => m.content === text)
      if (isReplay) {
        log.info('duplicate inbound content ignored (likely session resync replay)', { customer_id: c.id })
        return NextResponse.json({ status: 'ok' })
      }
    }

    const { data: latestDebt } = await supabase
      .from('debts').select('id, current_balance, status, portfolio:portfolios(name)').eq('customer_id', c.id)
      .not('status', 'in', '("settled","written_off")')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    const debt_id = (latestDebt as { id: string } | null)?.id ?? null

    const { data: insertedInbound, error: inboundInsertErr } = await supabase.from('messages').insert({
      company_id: c.company_id, customer_id: c.id, debt_id,
      channel: 'whatsapp', direction: 'inbound',
      // Voice notes are stored as their TRANSCRIPT (prefixed so staff can
      // tell it originated as audio, not typed) — the agent's own
      // conversation-history reads see the real words the customer said.
      content: isVoiceNote ? `🎤 (رسالة صوتية): ${text}` : (text || (mimetype === 'application/pdf' ? '📎 إيصال (PDF)' : '📎 إيصال (صورة)')),
      status: 'delivered',
      whatsapp_message_id: msgId,
      metadata: { provider: 'waha', from, ...(hasReceiptMedia && { media_url: mediaUrl, mimetype }), ...(isVoiceNote && { voice_note: true, mimetype }) },
      sent_at: new Date().toISOString(),
    }).select('id').single()
    // Real gap found during a full-system audit: not checked — a rejected
    // insert meant the customer's actual inbound message never existed in
    // the conversation history, even though the AI agent below still
    // processed and replied to it from the in-memory `text` — leaving a
    // reply on record with no visible message it was replying to.
    //
    // 🔴 REAL DUPLICATE-REPLY BUG (2026-07-06): the SELECT-based dedup check
    // above is a TOCTOU race — if WAHA redelivers the same message event
    // twice in quick succession (a known whatsapp-web.js/WAHA behavior),
    // both requests can pass that SELECT before either commits this INSERT,
    // so both go on to run the agent and both send a reply. Confirmed live:
    // a customer got two different replies to one message, 24s apart, with
    // only one inbound row on record. A partial unique index on
    // (whatsapp_message_id) WHERE direction='inbound' now makes the SECOND
    // insert for the same message fail atomically (Postgres 23505) — treat
    // that specific failure as a hard stop, not just a logged-and-continued
    // error, so the agent can never run twice for what WAHA considers one
    // message. Any OTHER insert failure still just logs and continues, same
    // as before, so a transient DB blip never silently drops a real message.
    if (inboundInsertErr) {
      if (inboundInsertErr.code === '23505') {
        log.info('duplicate inbound message blocked by DB constraint — WAHA redelivered the same event', { customer_id: c.id, msgId })
        return NextResponse.json({ status: 'ok' })
      }
      log.error('inbound message insert failed', { error: inboundInsertErr.message, customer_id: c.id })
    }

    if (c.ai_paused) { log.info('AI paused — skipping reply', { customer_id: c.id }); return NextResponse.json({ status: 'ok' }) }

    // Any image/PDF attachment → classify its ACTUAL content first. Real
    // production gap this fixes: every attachment used to be assumed a
    // payment receipt outright, and if the OCR verdict was "not a receipt"
    // the whole branch dead-ended with an early `return` — no reply, no
    // storage, no record it was ever received. Now: analyze first, store the
    // document under its real classification linked to the customer/debt,
    // ALWAYS reply, and only fall into the receipt-verification pipeline once
    // the content itself has actually been confirmed to be a receipt.
    if (hasReceiptMedia) {
      ;(async () => {
        try {
          const r = await fetch(wahaMediaUrl(mediaUrl), { headers: { 'X-Api-Key': WAHA_KEY ?? '' } })
          if (!r.ok) { log.error('document media download failed', undefined, { status: r.status }); return }
          const b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
          const isPdf = mimetype === 'application/pdf'

          const { classifyDocumentImage, classifyDocumentPdf } = await import('@/lib/document-classifier')
          const classification = isPdf ? await classifyDocumentPdf(b64) : await classifyDocumentImage(b64)

          // Persist the original file regardless of type — never OCR'd then
          // discarded. Non-critical: a storage failure never blocks the reply.
          let storagePath: string | null = null
          try {
            const ext = isPdf ? 'pdf' : 'jpg'
            const path = `${c.company_id}/${c.id}/${Date.now()}.${ext}`
            const { error: upErr } = await supabase.storage.from('customer-documents')
              .upload(path, Buffer.from(b64, 'base64'), { contentType: mimetype || (isPdf ? 'application/pdf' : 'image/jpeg') })
            if (!upErr) storagePath = path
            else log.error('customer document upload failed', new Error(upErr.message))
          } catch (e) {
            log.error('customer document upload threw', e as Error)
          }

          const { error: docInsertErr } = await supabase.from('customer_documents').insert({
            company_id: c.company_id, customer_id: c.id, debt_id,
            doc_type: classification.doc_type, needs_admin_review: classification.needs_admin_review,
            ai_summary: classification.summary, ai_confidence: classification.confidence,
            storage_path: storagePath, source: 'whatsapp', raw_analysis: classification,
          })
          if (docInsertErr) log.error('customer_documents insert failed', new Error(docInsertErr.message), { customer_id: c.id })

          // 🔴 Real production bug this fixes (customer 057da61b, 2026-07-09):
          // the classifier already analyzes the ACTUAL content of every
          // attachment (classification.summary), but that analysis was only
          // ever stored in customer_documents/admin alerts — never in the
          // conversation history itself. The stored inbound message stayed a
          // permanently opaque "📎 إيصال (صورة)" placeholder. Confirmed live:
          // a customer sent a photo, then in their VERY NEXT message
          // explained the outcome of a dispute they'd just filed related to
          // it — but the agent's case-file/history read for that next turn
          // had zero idea what the photo actually showed, because nothing
          // ever wrote the real content anywhere the agent could see it.
          // Enriching the message row itself (not just a side table) means
          // every later turn's conversation-history read sees the real
          // content, exactly like it would for typed text.
          if (insertedInbound?.id && classification.summary) {
            const docLabelAr: Record<string, string> = {
              receipt: 'إيصال', account_statement: 'كشف حساب', letter: 'خطاب رسمي',
              court_judgment: 'مستند قضائي', proof_of_payment: 'إثبات سداد',
              debt_waiver: 'مستند إسقاط دين', id_document: 'هوية', other: 'مرفق',
            }
            const label = docLabelAr[classification.doc_type] ?? 'مرفق'
            const enriched = text
              ? `${text}\n📎 ${label}: ${classification.summary}`
              : `📎 ${label}: ${classification.summary}`
            const { error: enrichErr } = await supabase.from('messages').update({ content: enriched }).eq('id', insertedInbound.id)
            if (enrichErr) log.error('inbound attachment content enrichment failed', new Error(enrichErr.message), { customer_id: c.id })
          }

          // Confirmed receipt → hand off to the dedicated OCR/verification
          // pipeline, which does its own beneficiary-matching and reply.
          if (classification.doc_type === 'receipt') {
            const { processInboundReceipt } = await import('@/lib/payment-receipt')
            await processInboundReceipt({
              company_id: c.company_id, customer_id: c.id, customer_name: c.full_name,
              debt_id, phone, source: isPdf ? 'pdf' : 'image', data: b64,
            })
            // Real gap found during a full-system audit: a document sent with
            // NO caption text never entered scheduleBurstProcessing at all
            // (see the early `return` right after this IIFE), which is the
            // only other place case-note updates fire — so the running case
            // note silently went stale on any document-only turn, receipt or
            // not. Every real event (including "customer sent a document")
            // must update the note, not just text turns.
            if (debt_id) {
              const { updateCaseNote } = await import('@/lib/case-note')
              await updateCaseNote({ company_id: c.company_id, debt_id })
            }
            return
          }

          // Every other classification still gets a reply — never silent.
          // Saudi-dialect phrasing the user specified for anything that might
          // require administrative review (statement/letter/judgment/proof of
          // payment/debt waiver).
          //
          // 🔴 Real production complaint this fixes: a non-receipt/non-review
          // attachment (doc_type='other') always got the exact same blind
          // "استلمت المرفق، شكراً لك." regardless of what the classifier's
          // own vision analysis actually found in it — the analysis existed
          // (classification.summary) but was never surfaced to the customer.
          // When the model produced a real, non-empty summary, reference it
          // directly instead of a generic line; the fixed line is only the
          // fallback for when analysis genuinely found nothing to describe
          // (empty summary — e.g. classification API failure or a truly
          // unreadable image).
          const ackMessage = classification.needs_admin_review
            ? 'شكراً لك، تم استلام المستند وتحليله، وسيتم رفعه للإدارة المختصة للمراجعة، وسنقوم بإبلاغك بالنتيجة بمجرد الانتهاء.'
            : classification.summary
            ? `تم استلام مرفقك (${classification.summary}). إذا له علاقة بموضوع مديونيتك وضّح لي كيف أقدر أساعدك فيه.`
            : 'استلمت المرفق، شكراً لك.'
          const wr = await sendWhatsAppMessage({ to: phone, message: ackMessage, company_id: c.company_id, customer_id: c.id })
          const { error: ackInsertErr } = await supabase.from('messages').insert({
            company_id: c.company_id, customer_id: c.id, debt_id,
            channel: 'whatsapp', direction: 'outbound', content: ackMessage,
            status: wr.status === 'sent' ? 'sent' : 'failed',
            whatsapp_message_id: wr.message_id || null,
            metadata: { sender: 'ai', action_type: 'document_ack', source: 'document_classification', doc_type: classification.doc_type },
            sent_at: new Date().toISOString(),
          })
          if (ackInsertErr) log.error('document ack message insert failed', new Error(ackInsertErr.message), { customer_id: c.id })

          if (classification.needs_admin_review) {
            await insertSystemAlert({
              company_id: c.company_id, severity: 'warning', alert_type: 'document_needs_review',
              title: `مستند يحتاج مراجعة: ${classification.doc_type}`,
              message: `العميل ${c.full_name ?? ''} أرسل مستنداً (${classification.doc_type}) — ${classification.summary || 'راجع المرفق للتفاصيل'}.`,
              metadata: { customer_id: c.id, debt_id, doc_type: classification.doc_type, storage_path: storagePath },
            })
          }
        } catch (err) {
          log.error('WAHA document processing error', err as Error)
        }
      })().catch(() => {})
      // If the customer sent ONLY media with no caption text, there's nothing
      // for the conversational agent to respond to beyond the document
      // acknowledgment handled above — stop here. If they also sent text
      // alongside the attachment, fall through so the agent still processes it.
      if (!text) return NextResponse.json({ status: 'ok' })
    }

    // Run the collector agent and reply (sendWhatsAppMessage routes via WAHA).
    // Debounced/merged across a rapid-fire burst — see scheduleBurstProcessing.
    scheduleBurstProcessing(c.id, text, messageTimestamp, async (mergedText, latestTimestamp) => {
      const { runCollectorAgent, detectSignals } = await import('@/lib/ai-collector-agent')
      const { processEvent } = await import('@/lib/automation-pipeline')

      const aiDecision = await runCollectorAgent({
        company_id: c.company_id, customer_id: c.id, debt_id, message: mergedText, messageTimestamp: latestTimestamp,
      })

      // The agent may internally resolve a DIFFERENT debt than the one this
      // webhook picked (multi-portfolio customers) — every side-effect write
      // below must attach to that one, not the webhook's own guess.
      const effectiveDebtId = aiDecision.resolvedDebtId ?? debt_id

      if (aiDecision.shouldReply && aiDecision.message) {
        const waResult = await sendWhatsAppMessage({ to: phone, message: aiDecision.message, company_id: c.company_id, customer_id: c.id })
        const { error: replyInsertErr } = await supabase.from('messages').insert({
          company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
          channel: 'whatsapp', direction: 'outbound', content: aiDecision.message,
          status: waResult.status === 'sent' ? 'sent' : 'failed',
          whatsapp_message_id: waResult.message_id || null,
          metadata: { sender: 'ai', action_type: aiDecision.action, provider: 'waha', error: waResult.error },
          sent_at: new Date().toISOString(),
        })
        // Real gap found during a full-system audit: not checked — the AI
        // reply was still sent to the customer over WhatsApp either way, but
        // a rejected insert meant it never appeared in the conversation
        // history, making the dashboard look like the customer's message
        // was never answered when it actually was.
        if (replyInsertErr) log.error('AI reply message insert failed', new Error(replyInsertErr.message), { customer_id: c.id })
        if (waResult.status === 'sent') {
          // Real bug this fixes: `message` here used to be aiDecision.message
          // (the AI's own outgoing reply) — but stepLiveReactor/
          // stepAISystemImpact in automation-pipeline.ts read this field to
          // classify the CUSTOMER's intent (dispute/paid_claim/refusal/
          // promise wording). Every classification was running on what the
          // AI said back to the customer, not what the customer actually
          // said — confirmed live in production (an approval's "customer
          // claim" was literally the AI's own reply text). mergedText (the
          // customer's real inbound message, already in this closure) is
          // the correct signal; the AI's reply is kept under its own field
          // for anything that specifically needs it.
          await processEvent({
            debt_id: effectiveDebtId ?? 'temp', company_id: c.company_id,
            source: 'ai_reply',
            data: { message: mergedText, ai_reply: aiDecision.message, action: aiDecision.action },
          }).catch(e => log.error('pipeline failed', e as Error))
        }
      }

      // Wrong number → stop the collection workflow outright. Real production
      // gap this fixes: someone replying that they aren't the customer used
      // to get re-introduced to and kept in the normal collection flow, since
      // nothing ever recorded this or paused outbound messages to the number.
      // Never resumes automatically — a human must review and either correct
      // the phone on file or confirm it's genuinely unreachable.
      if (aiDecision.action === 'record_wrong_number') {
        const { error: pauseErr } = await supabase.from('customers').update({ ai_paused: true }).eq('id', c.id)
        if (pauseErr) log.error('failed to pause AI for wrong-number report', new Error(pauseErr.message), { customer_id: c.id })
        await insertTimelineEvent({
          company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
          event_type: 'status_change', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
          summary: 'الرقم أفاد بأنه ليس العميل المطلوب — تم إيقاف التواصل التلقائي',
          detail: mergedText.slice(0, 500),
        })
        await insertSystemAlert({
          company_id: c.company_id, severity: 'warning', alert_type: 'wrong_number_reported',
          title: `رقم غير صحيح: ${c.full_name ?? phone}`,
          message: `الرد من الرقم ${phone} يفيد بأنه ليس العميل المطلوب. تم إيقاف الرد الآلي على هذا الرقم — راجع بيانات التواصل وحدّثها أو أعد التفعيل يدوياً.`,
          metadata: { customer_id: c.id, debt_id: effectiveDebtId, phone, customer_message: mergedText },
        })
      }

      // human_review → the agent decided this needs a person, WITHOUT
      // stopping collection. Main current source: an أبشر-verified customer
      // who keeps insisting the confirmed number isn't theirs — the debt
      // stays fully active (ai NOT paused) but a human should look. Surfaced
      // as an alert so it appears on the التنبيهات page.
      if (aiDecision.action === 'human_review') {
        await insertSystemAlert({
          company_id: c.company_id, severity: 'warning', alert_type: 'needs_human_review',
          title: `يحتاج مراجعة بشرية: ${c.full_name ?? phone}`,
          message: `العميل ${c.full_name ?? phone} يصرّ على أن الرقم ليس رقمه رغم أنه مؤكد من أبشر. المديونية باقية قائمة والتواصل مستمر — راجع الحالة يدوياً.`,
          metadata: { customer_id: c.id, debt_id: effectiveDebtId, phone, customer_message: mergedText, reason: aiDecision.reason ?? null },
        })
        await insertTimelineEvent({
          company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
          event_type: 'status_change', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
          summary: 'رُفعت الحالة لمراجعة بشرية (إصرار على رقم مؤكد من أبشر) — التحصيل مستمر',
          detail: mergedText.slice(0, 500),
        })
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
      //
      // Real gap this fixes: this always recorded the promise as if the
      // customer committed to the FULL current_balance, even when they
      // explicitly named a smaller amount (e.g. "بسدد 200 الشهر" against a
      // 789 balance) — there was no way to tell "promised full payment"
      // apart from "promised a partial/installment amount" anywhere in the
      // system. aiDecision.promised_partial_amount is only set by the model
      // when the customer's own words specified a smaller number.
      if (aiDecision.action === 'record_promise' && effectiveDebtId && aiDecision.promised_date) {
        const { recordPromise } = await import('@/lib/promise')
        const fullBalance = Number((latestDebt as { current_balance?: number } | null)?.current_balance ?? 0)
        const partial = aiDecision.promised_partial_amount
        const isPartial = typeof partial === 'number' && partial > 0 && partial < fullBalance
        await recordPromise({
          company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
          promised_amount: isPartial ? partial : fullBalance,
          promised_date: aiDecision.promised_date, customer_message: mergedText,
          promise_text: aiDecision.promise_text ?? null,
          promise_type: isPartial ? 'partial' : 'full',
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
        await insertSystemAlert({
          company_id: c.company_id, severity: 'warning', alert_type: 'promise_not_recorded',
          title: 'وعد سداد لم يُسجَّل تلقائياً',
          message: `العميل ${c.full_name} قد يكون أُخبر بأن وعده مسجَّل، لكن لم يُستخرج تاريخ صريح من رسالته — راجع المحادثة وسجّل الوعد يدوياً إذا لزم.`,
          metadata: { customer_id: c.id, debt_id: effectiveDebtId, customer_message: mergedText },
        })
      }

      // Real production gap: nothing in the system ever marked a promise
      // 'broken' when the customer explicitly retracted/refused it mid-
      // conversation ("ما اتفقت معك على شي وماراح اسدد") — only an actual
      // payment ever resolved a promise (to 'kept'/'partial'). The promises
      // page kept showing it as a standing, open promise forever, directly
      // contradicting what the conversation itself showed. This fires
      // independently of which action the model chose this turn.
      if (effectiveDebtId) {
        const turnSignals = detectSignals(mergedText)
        if (turnSignals.deniesPromise || turnSignals.refusesToPay) {
          const { markOpenPromiseBroken } = await import('@/lib/promise')
          await markOpenPromiseBroken({ debt_id: effectiveDebtId, customer_message: mergedText })
        }
      }

      // Company-specific outcome classification (from "تصنيفات جميع
      // الشركات.xlsx") — only runs for the 11 known company profiles;
      // manual/generic portfolios get null and are untouched.
      if (effectiveDebtId) {
        const portfolioName = (latestDebt as { portfolio?: { name?: string } } | null)?.portfolio?.name ?? null
        const { classifyDebtOutcome } = await import('@/lib/debt-status-classifier')
        const outcome = await classifyDebtOutcome({ portfolio_name: portfolioName, customer_message: mergedText, debt_id: effectiveDebtId, customer_id: c.id })

        if (outcome) {
          const { category, meta } = outcome
          const oldStatus = (latestDebt as { status?: string } | null)?.status ?? null

          const { error: outcomeUpdErr } = await supabase.from('debts').update({
            original_sub_status: category,
            normalized_status: meta.status ?? oldStatus,
            ...(meta.status ? { status: meta.status } : {}),
            updated_at: new Date().toISOString(),
          }).eq('id', effectiveDebtId)
          if (outcomeUpdErr) log.error('debt outcome-classification update failed', new Error(outcomeUpdErr.message), { debt_id: effectiveDebtId, category })

          const { error: statusHistErr } = await supabase.from('collection_status_history').insert({
            company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
            source_system: 'ai_agent',
            old_status: oldStatus, new_status: category,
            normalized_status: meta.status,
            changed_by_name: 'AI Agent',
            raw_payload: { customer_message: mergedText },
            changed_at: new Date().toISOString(),
          })
          if (statusHistErr) log.error('collection_status_history insert failed', new Error(statusHistErr.message), { debt_id: effectiveDebtId })

          // 'outcome_classified' is NOT a valid timeline_events.event_type
          // (CHECK constraint only allows a fixed list) — this insert has
          // been silently failing every single time a classification
          // happened since this feature shipped (Supabase JS doesn't throw
          // on a constraint violation, it just returns an unchecked error).
          // 'status_change' is the correct semantic fit since this event IS
          // exactly that — a status change driven by the classification.
          const { error: classifyTimelineErr } = await supabase.from('timeline_events').insert({
            company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
            event_type: 'status_change', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
            summary: `تصنيف الحالة: ${category}`,
            detail: meta.meaning, occurred_at: new Date().toISOString(),
          })
          if (classifyTimelineErr) log.error('outcome classification timeline insert failed', new Error(classifyTimelineErr.message), { debt_id: effectiveDebtId })

          if (meta.isTerminal) {
            const { error: terminalPauseErr } = await supabase.from('customers').update({ ai_paused: true }).eq('id', c.id)
            // Real gap found during a full-system audit: not checked — this
            // is the single highest-stakes update in this block (deceased/
            // imprisoned/bankrupt outcomes are supposed to permanently stop
            // AI replies). A rejected update meant the "stopped" alert fired
            // below regardless, telling staff the AI was paused for this
            // customer while the AI kept messaging them.
            if (terminalPauseErr) log.error('failed to pause AI for terminal outcome', new Error(terminalPauseErr.message), { customer_id: c.id, category })
            // 'high' is not a valid system_alerts.severity (the real CHECK
            // constraint only allows info/warning/error/critical) — this
            // insert has been failing silently every time a terminal
            // outcome (deceased/imprisoned/bankrupt) was classified, since
            // the feature shipped. 'critical' is the correct fit — these
            // are exactly the cases meant to stop AI replies and need a
            // human immediately.
            await insertSystemAlert({
              company_id: c.company_id, severity: 'critical', alert_type: 'outcome_needs_human_review',
              title: `يحتاج مراجعة بشرية: ${category}`,
              message: `العميل ${c.full_name} صُنّف بحالة "${category}" — ${meta.meaning} تم إيقاف الرد التلقائي على هذا العميل.`,
              metadata: { customer_id: c.id, debt_id: effectiveDebtId, category },
            })
          }
        }
      }

      // Running case note — there's no "conversation ended" event in this
      // system (every message is processed independently), so this updates
      // after every real exchange instead, so it's always current. Real gap
      // this fixes: this was gated on `aiDecision.shouldReply && message` —
      // if the agent's LAST turn in a conversation was a deliberate silence
      // (e.g. the customer just said "طيب" with nothing left to add), the
      // note froze one exchange behind what actually happened, since
      // nothing ever ran again after that. Now updates on every processed
      // turn regardless of whether the agent replied, so the note reflects
      // the real latest state of the conversation, not just the state as of
      // the last time the agent happened to send something.
      if (effectiveDebtId) {
        const { updateCaseNote } = await import('@/lib/case-note')
        await updateCaseNote({ company_id: c.company_id, debt_id: effectiveDebtId })
      }
    })

    return NextResponse.json({ status: 'ok' })
  } catch (err) {
    log.error('WAHA webhook error', err as Error)
    return NextResponse.json({ status: 'ok' })
  }
}
