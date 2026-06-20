import { createServiceClient } from '@/lib/supabase/server'
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
  promised_date: string // YYYY-MM-DD, already validated by the caller
  customer_message: string
}): Promise<void> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('promises').select('id')
    .eq('company_id', args.company_id).eq('debt_id', args.debt_id).eq('status', 'pending')
    .limit(1).maybeSingle()
  if (existing) {
    log.info('pending promise already exists for this debt — not duplicating', { debt_id: args.debt_id })
    return
  }

  await supabase.from('promises').insert({
    company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
    promised_amount: args.promised_amount, promised_date: args.promised_date,
    channel: 'whatsapp', status: 'pending',
    notes: `كلام العميل: "${args.customer_message}"`,
  })
  await supabase.from('debts').update({ status: 'promised' }).eq('id', args.debt_id)
}
