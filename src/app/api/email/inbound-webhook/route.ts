import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendEmail } from '@/lib/email'
import { createLogger } from '@/lib/logger'

const log = createLogger('webhook/email')

// Infrastructure-only, same as src/lib/email.ts — no real provider chosen
// yet. The payload shape below ({from, subject, text}) is a reasonable
// generic placeholder; once a provider (Postmark/Mailgun/Resend) is picked,
// the ONLY change needed here is adapting these three lines to that
// provider's actual webhook body — everything after (customer matching,
// running the agent, sending the reply, logging to the timeline) already
// works and mirrors src/app/api/whatsapp/waha-webhook/route.ts exactly, so
// email messages show up on the same customer timeline as WhatsApp ones
// automatically (messages.channel already allows 'email' — no migration
// needed for that part).
export async function POST(req: NextRequest) {
  // Real gap found during a full-system security audit: when
  // EMAIL_INBOUND_SECRET was unset, this fell through to processing the
  // request anyway (only logging an error) — meaning the route was live and
  // fully open to the public internet, able to write messages/trigger the
  // AI agent against any customer whose email happened to match an
  // attacker-supplied `from`. Confirmed live in production: the env var was
  // never set, so this was genuinely exploitable, not theoretical. Same
  // fix pattern as waha-webhook/rasf-webhook: fail CLOSED (503, service
  // disabled) when unconfigured, never fail open.
  if (!process.env.EMAIL_INBOUND_SECRET) {
    log.error('EMAIL_INBOUND_SECRET is not set — email inbound webhook is disabled until configured')
    return NextResponse.json({ error: 'Service not configured' }, { status: 503 })
  }
  const secret = req.headers.get('x-webhook-secret')
  if (secret !== process.env.EMAIL_INBOUND_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await req.json().catch(() => null)
  const from = String(payload?.from ?? '').trim().toLowerCase()
  const subject = String(payload?.subject ?? '').trim()
  const text = String(payload?.text ?? '').trim()
  if (!from || !text) return NextResponse.json({ status: 'ok' })

  // KNOWN LIMITATION, flagged honestly rather than guessed around: this
  // matches a customer by email alone, across ALL companies on the
  // platform, with no company-scoping at the match step. The equivalent
  // WhatsApp webhook does the same thing (matches by phone with no
  // company_id filter) and that is safe in practice because each WAHA
  // session is dedicated to exactly one company — the inbound channel
  // itself already implies the company. That assumption does NOT
  // necessarily hold for email: depending on which provider is chosen,
  // inbound mail for every company on the platform could hit this same
  // webhook URL, so if two different companies ever have a customer
  // sharing the same email address, `.limit(1)` could non-deterministically
  // pick the wrong one. Resolve this properly once a real provider is
  // chosen — most (Postmark/Mailgun) support a distinct inbound address or
  // a routing token per sender identity, which should be used to scope
  // this query by company_id, same as every other route in this app.
  const supabase = createServiceClient()
  const { data: customer } = await supabase
    .from('customers').select('id, company_id, full_name, ai_paused')
    .eq('email', from).limit(1).maybeSingle()

  if (!customer) { log.warn('no customer for inbound email', { from }); return NextResponse.json({ status: 'ok' }) }
  const c = customer as { id: string; company_id: string; full_name?: string; ai_paused?: boolean }

  const { data: latestDebt } = await supabase
    .from('debts').select('id').eq('customer_id', c.id)
    .not('status', 'in', '("settled","written_off")')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const debt_id = (latestDebt as { id: string } | null)?.id ?? null

  const { error: inboundEmailErr } = await supabase.from('messages').insert({
    company_id: c.company_id, customer_id: c.id, debt_id,
    channel: 'email', direction: 'inbound', content: text,
    status: 'delivered', metadata: { subject, from },
    sent_at: new Date().toISOString(),
  })
  if (inboundEmailErr) log.error('inbound email message insert failed', inboundEmailErr, { customer_id: c.id })

  if (c.ai_paused) { log.info('AI paused — skipping email reply', { customer_id: c.id }); return NextResponse.json({ status: 'ok' }) }

  const { runCollectorAgent } = await import('@/lib/ai-collector-agent')
  const aiDecision = await runCollectorAgent({
    company_id: c.company_id, customer_id: c.id, debt_id, message: text, messageTimestamp: new Date().toISOString(),
  })

  if (aiDecision.shouldReply && aiDecision.message) {
    const effectiveDebtId = aiDecision.resolvedDebtId ?? debt_id
    const sendResult = await sendEmail({
      to: from, subject: subject ? `Re: ${subject}` : 'بخصوص ملفك', body: aiDecision.message, company_id: c.company_id,
    })
    const { error: outboundEmailErr } = await supabase.from('messages').insert({
      company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
      channel: 'email', direction: 'outbound', content: aiDecision.message,
      status: sendResult.status === 'sent' ? 'sent' : 'failed',
      metadata: { sender: 'ai', action_type: aiDecision.action, error: sendResult.error ?? null },
      sent_at: new Date().toISOString(),
    })
    if (outboundEmailErr) log.error('outbound email message log failed', outboundEmailErr, { customer_id: c.id })
  }

  return NextResponse.json({ status: 'ok' })
}
