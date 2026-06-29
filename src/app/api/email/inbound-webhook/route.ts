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
  const secret = req.headers.get('x-webhook-secret')
  if (secret !== process.env.EMAIL_INBOUND_SECRET) {
    if (process.env.EMAIL_INBOUND_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    log.error('EMAIL_INBOUND_SECRET is not set — this webhook is unauthenticated and publicly triggerable')
  }

  const payload = await req.json().catch(() => null)
  const from = String(payload?.from ?? '').trim().toLowerCase()
  const subject = String(payload?.subject ?? '').trim()
  const text = String(payload?.text ?? '').trim()
  if (!from || !text) return NextResponse.json({ status: 'ok' })

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

  await supabase.from('messages').insert({
    company_id: c.company_id, customer_id: c.id, debt_id,
    channel: 'email', direction: 'inbound', content: text,
    status: 'delivered', metadata: { subject, from },
    sent_at: new Date().toISOString(),
  })

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
    await supabase.from('messages').insert({
      company_id: c.company_id, customer_id: c.id, debt_id: effectiveDebtId,
      channel: 'email', direction: 'outbound', content: aiDecision.message,
      status: sendResult.status === 'sent' ? 'sent' : 'failed',
      metadata: { sender: 'ai', action_type: aiDecision.action, error: sendResult.error ?? null },
      sent_at: new Date().toISOString(),
    })
  }

  return NextResponse.json({ status: 'ok' })
}
