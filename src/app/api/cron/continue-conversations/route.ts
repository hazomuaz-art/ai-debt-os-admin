import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runCollectorAgent } from '@/lib/ai-collector-agent'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { isWhatsAppSessionHealthy } from '@/lib/send-gate'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/continue-conversations')

const RESOLVED_STATUSES = ['settled', 'written_off']
const LOOKBACK_DAYS = 3
const UNANSWERED_MIN_AGE_MIN = 20   // give the live webhook time to reply first
const MAX_PER_RUN = 40

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

  // Circuit breaker — same production incident as send-campaign-queue: don't
  // spend an LLM call and a WAHA request per customer when the health check
  // already knows the session is down.
  if (!(await isWhatsAppSessionHealthy())) {
    log.warn('WhatsApp session unhealthy — skipping this run entirely')
    return NextResponse.json({ message: 'Skipped — WhatsApp session unhealthy' })
  }

  const supabase = createServiceClient()
  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString()

  // Pull recent WhatsApp messages, reduce to the latest message per customer.
  const { data: recent, error } = await supabase
    .from('messages')
    .select('customer_id, company_id, debt_id, direction, content, sent_at')
    .eq('channel', 'whatsapp')
    .gte('sent_at', sinceIso)
    .order('sent_at', { ascending: false })
    .limit(1000)

  if (error) {
    log.error('fetch recent messages failed', error)
    return NextResponse.json({ error: 'fetch failed' }, { status: 500 })
  }

  const latestByCustomer = new Map<string, any>()
  for (const m of recent ?? []) {
    if (m.customer_id && !latestByCustomer.has(m.customer_id)) latestByCustomer.set(m.customer_id, m)
  }

  const now = Date.now()
  const results = { scanned: latestByCustomer.size, continued: 0, skipped: 0, failed: 0 }

  for (const [customerId, last] of latestByCustomer) {
    if (results.continued >= MAX_PER_RUN) break

    // Only act on conversations the customer left open (their message was last).
    if (last.direction !== 'inbound') { results.skipped++; continue }
    const ageMin = (now - new Date(last.sent_at).getTime()) / 60000
    if (ageMin < UNANSWERED_MIN_AGE_MIN) { results.skipped++; continue }

    // Resolve customer + open debt
    const { data: customer } = await supabase
      .from('customers').select('id, whatsapp, phone, ai_paused').eq('id', customerId).maybeSingle()
    if (customer?.ai_paused) { results.skipped++; continue }   // human is handling this one
    const phone = customer?.whatsapp || customer?.phone
    if (!phone) { results.skipped++; continue }

    const { data: debt } = await supabase
      .from('debts')
      .select('id, status')
      .eq('company_id', last.company_id)
      .eq('customer_id', customerId)
      .not('status', 'in', `(${RESOLVED_STATUSES.map(s => `"${s}"`).join(',')})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!debt) { results.skipped++; continue }   // no open debt → status effectively resolved

    try {
      // Customer spoke last and was never answered → continue via the collector agent
      const decision = await runCollectorAgent({
        company_id: last.company_id,
        customer_id: customerId,
        debt_id: debt.id,
        message: String(last.content ?? ''),
        messageTimestamp: last.sent_at ?? undefined,
      })
      if (decision.shouldReply && decision.message) {
        const r = await sendWhatsAppMessage({ to: phone, message: decision.message, company_id: last.company_id, customer_id: customerId })
        await recordOutbound(supabase, last.company_id, customerId, debt.id, decision.message, r, 'continue_unanswered', decision.action)
        if (r.status === 'sent') results.continued++; else results.failed++
      } else {
        results.skipped++
      }
    } catch (e) {
      log.error(`continue failed for customer ${customerId}`, e)
      results.failed++
    }
  }

  log.info('continue-conversations run', results)
  return NextResponse.json({ message: 'done', results })
}

async function recordOutbound(
  supabase: any, company_id: string, customer_id: string, debt_id: string,
  content: string, r: { status: string; message_id?: string | null; error?: string | null }, source: string, action: string,
) {
  const { error } = await supabase.from('messages').insert({
    company_id, customer_id, debt_id,
    channel: 'whatsapp', direction: 'outbound', content,
    status: r.status === 'sent' ? 'sent' : 'failed',
    whatsapp_message_id: r.message_id || null,
    sent_at: new Date().toISOString(),
    metadata: { sender: 'ai', source, action_type: action, error: r.error ?? null },
  })
  // Real gap found during a full-system audit: not checked — the WhatsApp
  // message was still sent to the customer either way, but a rejected
  // insert meant it never showed up in the conversation history.
  if (error) log.error('continue-conversations outbound log failed', new Error(error.message), { debt_id })
}
