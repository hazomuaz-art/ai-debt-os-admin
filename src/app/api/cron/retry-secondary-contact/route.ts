import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateOpeningMessage } from '@/lib/opening-message'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/retry-secondary-contact')

const RESOLVED_STATUSES = ['settled', 'written_off']
// If the primary number has had ZERO reply at all for this long since the
// very first outbound attempt, it's reasonable to try a secondary contact
// on file (relative/known contact) — per the explicit decision that this
// happens automatically, same conversational style, no human approval step.
const SILENCE_DAYS = 5
const MAX_PER_RUN = 30

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.APP_SECRET}` && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const results = { scanned: 0, tried_secondary: 0, skipped: 0, failed: 0 }

  // Candidates: customers with an open debt, AI not paused, who have at
  // least one secondary contact still untried.
  const { data: candidates } = await supabase
    .from('customer_contacts')
    .select('customer_id, company_id, phone, is_primary, status, created_at')
    .eq('status', 'untried')
    .eq('is_primary', false)
    .order('created_at', { ascending: true })
    .limit(200)

  const byCustomer = new Map<string, { customer_id: string; company_id: string; phone: string }>()
  for (const row of (candidates ?? []) as any[]) {
    if (!byCustomer.has(row.customer_id)) byCustomer.set(row.customer_id, row)
  }
  results.scanned = byCustomer.size

  const sinceIso = new Date(Date.now() - SILENCE_DAYS * 86400000).toISOString()

  for (const [customerId, secondary] of byCustomer) {
    if (results.tried_secondary >= MAX_PER_RUN) break

    const { data: customer } = await supabase
      .from('customers').select('id, full_name, ai_paused').eq('id', customerId).eq('company_id', secondary.company_id).maybeSingle()
    if (!customer || customer.ai_paused) { results.skipped++; continue }

    // Zero reply EVER, and the first outbound attempt was long enough ago.
    const { data: anyInbound } = await supabase
      .from('messages').select('id').eq('customer_id', customerId).eq('direction', 'inbound').limit(1).maybeSingle()
    if (anyInbound) { results.skipped++; continue }   // they did reply at some point — not silence, a different situation

    const { data: firstOutbound } = await supabase
      .from('messages').select('sent_at').eq('customer_id', customerId).eq('direction', 'outbound')
      .order('sent_at', { ascending: true }).limit(1).maybeSingle()
    if (!firstOutbound || firstOutbound.sent_at > sinceIso) { results.skipped++; continue }   // too soon to give up on the primary number yet

    const { data: debt } = await supabase
      .from('debts').select('id').eq('company_id', secondary.company_id).eq('customer_id', customerId)
      .not('status', 'in', `(${RESOLVED_STATUSES.map(s => `"${s}"`).join(',')})`)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!debt) { results.skipped++; continue }

    try {
      // Mark every untried/primary contact that's gone silent this long as
      // no_reply, then move to the next untried secondary number.
      await supabase.from('customer_contacts').update({ status: 'no_reply' })
        .eq('customer_id', customerId).eq('company_id', secondary.company_id).eq('is_primary', true).neq('status', 'wrong_number')

      const message = await generateOpeningMessage({ company_id: secondary.company_id, customer_id: customerId, debt_id: debt.id })
      const sendResult = await sendWhatsAppMessage({ to: secondary.phone, message, company_id: secondary.company_id })

      await supabase.from('messages').insert({
        company_id: secondary.company_id, customer_id: customerId, debt_id: debt.id,
        channel: 'whatsapp', direction: 'outbound', content: message,
        status: sendResult.status === 'sent' ? 'sent' : 'failed',
        whatsapp_message_id: sendResult.message_id || null,
        sent_at: new Date().toISOString(),
        metadata: { sender: 'ai', source: 'retry_secondary_contact', to_secondary_phone: secondary.phone },
      })

      await supabase.from('customer_contacts')
        .update({ status: sendResult.status === 'sent' ? 'delivered' : 'untried' })
        .eq('customer_id', customerId).eq('company_id', secondary.company_id).eq('phone', secondary.phone)

      if (sendResult.status === 'sent') results.tried_secondary++; else results.failed++
    } catch (e) {
      log.error(`retry-secondary-contact failed for customer ${customerId}`, e as Error)
      results.failed++
    }
  }

  log.info('retry-secondary-contact run', results)
  return NextResponse.json({ message: 'done', results })
}
