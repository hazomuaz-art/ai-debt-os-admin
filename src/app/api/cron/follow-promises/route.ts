import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateProactiveReminder } from '@/lib/ai-whatsapp-reply'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/follow-promises')

export async function GET(req: NextRequest) {
  // Simple basic security: verify authorization header
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.APP_SECRET}` && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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

  const results = { sent: 0, failed: 0 }

  for (const promise of duePromises) {
    const debt = promise.debts
    const customer = debt?.customers
    if (!debt || !customer) continue

    const phone = customer.whatsapp || customer.phone
    if (!phone) continue

    try {
      const reminderMsg = await generateProactiveReminder({
        company_id: promise.company_id,
        customer_id: customer.id,
        debt_id: debt.id,
        reason: `Customer promised to pay ${promise.promised_amount} on ${promise.promised_date} but payment has not been marked as received. Reach out to follow up.`,
      })

      if (reminderMsg) {
        const sendResult = await sendWhatsAppMessage({
          to: phone,
          message: reminderMsg,
          company_id: promise.company_id,
        })

        // Always record the outbound message in the conversation (so it shows in the dashboard),
        // even if delivery failed (status reflects that).
        await supabase.from('messages').insert({
          company_id: promise.company_id,
          customer_id: customer.id,
          debt_id: debt.id,
          channel: 'whatsapp',
          direction: 'outbound',
          content: reminderMsg,
          status: sendResult.status === 'sent' ? 'sent' : 'failed',
          whatsapp_message_id: sendResult.message_id || null,
          metadata: { sender: 'ai', action_type: 'reply', source: 'promise_followup', error: sendResult.error ?? null },
          sent_at: new Date().toISOString(),
        })

        if (sendResult.status === 'sent') {
          // Mark as followed_up to avoid re-spamming the same promise
          await supabase
            .from('promises')
            .update({ status: 'followed_up' })
            .eq('id', promise.id)

          // Log to timeline
          await supabase.from('timeline_events').insert({
            company_id: promise.company_id,
            debt_id: debt.id,
            event_type: 'bot_action',
            channel: 'whatsapp',
            summary: 'تم إرسال تذكير تلقائي بالوعد',
            detail: `الرسالة: ${reminderMsg}`,
            occurred_at: new Date().toISOString()
          })

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

  return NextResponse.json({ 
    message: 'Finished processing promises',
    results 
  })
}
