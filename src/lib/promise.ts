import { createServiceClient } from '@/lib/supabase/server'
import { recordAttribution } from '@/lib/revenue-attribution'
import { createLogger } from '@/lib/logger'

const log = createLogger('promise')

/**
 * Records a payment promise — but ONLY ever called when the collector
 * agent itself explicitly decided action === 'record_promise' with a real
 * date it extracted from the customer's own words (see ai-collector-agent.ts
 * "fabricated promise guard"). This replaces a removed pipeline heuristic
 * that used to guess dates from loose keyword matches and invent promises
 * the customer never actually made.
 */
export async function recordPromise(args: {
  company_id: string
  customer_id: string
  debt_id: string
  promised_amount: number
  promised_date: string // YYYY-MM-DD, best-effort date (column is NOT NULL)
  customer_message: string
  // The customer's timing in their own words/meaning ("مع الراتب", "بداية الشهر
  // الجاي", "بكرا"...). Stored verbatim so later turns reference the real
  // promise even when the date is only a best-effort conversion.
  promise_text?: string | null
}): Promise<void> {
  const supabase = createServiceClient()

  const noteParts: string[] = []
  if (args.promise_text) noteParts.push(`توقيت العميل: ${args.promise_text}`)
  noteParts.push(`كلام العميل: "${args.customer_message}"`)
  const notes = noteParts.join(' — ')
  const followUp = `${args.promised_date}T09:00:00+03:00`

  // If a pending promise already exists, UPDATE it (the customer may have moved
  // or clarified the date) rather than duplicating — keeps one source of truth.
  const { data: existing } = await supabase
    .from('promises').select('id')
    .eq('company_id', args.company_id).eq('debt_id', args.debt_id).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  if (existing) {
    await supabase.from('promises').update({
      promised_date: args.promised_date, promised_amount: args.promised_amount,
      notes, follow_up_at: followUp,
    }).eq('id', (existing as { id: string }).id)
    log.info('updated standing promise', { debt_id: args.debt_id, promised_date: args.promised_date })
  } else {
    const { data: created } = await supabase.from('promises').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      promised_amount: args.promised_amount, promised_date: args.promised_date,
      channel: 'whatsapp', status: 'pending', notes, follow_up_at: followUp,
    }).select('id').single()
    log.info('recorded new promise', { debt_id: args.debt_id, promised_date: args.promised_date })

    // Attribution: a genuinely NEW promise only — updating an existing
    // pending one (the `if (existing)` branch above) is the same promise
    // event, not a second one, so it does not get a second attribution row.
    if (created) {
      await recordAttribution({
        company_id: args.company_id,
        event_type: 'promise',
        source_id: (created as { id: string }).id,
        customer_id: args.customer_id,
        debt_id: args.debt_id,
        amount: args.promised_amount,
        primary_channel: 'whatsapp',
        primary_actor: 'ai',
        ai_assisted: true,
      })
    }
  }

  await supabase.from('debts').update({ status: 'promised' }).eq('id', args.debt_id)

  // A customer who just made a promise is no longer "refusing" — clear any
  // accumulated refusal count so the 3-refusals/48h legal-escalation trigger
  // doesn't fire later off stale refusals from before this cooperation.
  const { resetRefusalTracking } = await import('@/lib/legal-escalation')
  await resetRefusalTracking(args.debt_id)

  // Reflect the promise on the customer timeline immediately so the profile,
  // history and follow-ups all stay in sync (not stuck in one part of the app).
  try {
    await supabase.from('timeline_events').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      event_type: 'promise_to_pay', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: `وعد سداد${args.promise_text ? ` (${args.promise_text})` : ''} بتاريخ ${args.promised_date}`,
      detail: notes, occurred_at: new Date().toISOString(),
    })
  } catch (e) {
    log.error('promise timeline insert failed', e as Error)
  }
}

/**
 * Marks the debt's currently-open promise (status 'pending') as 'broken'.
 *
 * Real production gap this fixes: nothing in the system ever transitioned a
 * promise out of 'pending' except an actual payment arriving (which marks
 * it 'kept'/'partial' — see payment-receipt.ts). A customer who explicitly
 * retracted their own promise mid-conversation ("ما اتفقت معك على شي
 * وماراح اسدد") was left showing as a standing, unresolved promise forever
 * — the promises page kept saying "واعد" even though the conversation
 * itself showed the opposite. Called from the webhook whenever
 * signals.deniesPromise or signals.refusesToPay fires against a debt that
 * has an open promise on file.
 */
export async function markOpenPromiseBroken(args: {
  debt_id: string
  customer_message: string
}): Promise<void> {
  const supabase = createServiceClient()
  const { data: existing } = await supabase
    .from('promises').select('id, company_id, customer_id')
    .eq('debt_id', args.debt_id).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!existing) return

  const row = existing as { id: string; company_id: string; customer_id: string }
  await supabase.from('promises').update({ status: 'broken' }).eq('id', row.id)
  log.info('promise marked broken — customer explicitly retracted/refused', { debt_id: args.debt_id, promise_id: row.id })

  try {
    await supabase.from('timeline_events').insert({
      company_id: row.company_id, customer_id: row.customer_id, debt_id: args.debt_id,
      event_type: 'status_change', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: 'العميل تراجع عن وعده/رفض السداد', detail: `كلام العميل: "${args.customer_message}"`,
      occurred_at: new Date().toISOString(),
    })
  } catch (e) {
    log.error('promise-broken timeline insert failed', e as Error)
  }
}
