import { createServiceClient } from '@/lib/supabase/server'

export async function buildCustomerDebtContext(params: {
  company_id: string
  customer_id: string
  debt_id?: string | null
}) {
  const supabase = createServiceClient()

  const { data: customer } = await supabase
    .from('customers')
    .select('id, full_name, city, country, risk_level, notes, metadata')
    .eq('id', params.customer_id)
    .eq('company_id', params.company_id)
    .maybeSingle()

  const debtQuery = supabase
    .from('debts')
    .select('id, reference_number, original_amount, current_balance, currency, status, priority, due_date, last_payment_date, product_type, creditor_name, account_number, notes, metadata')
    .eq('company_id', params.company_id)
    .eq('customer_id', params.customer_id)

  const { data: debt } = params.debt_id
    ? await debtQuery.eq('id', params.debt_id).maybeSingle()
    : await debtQuery
        .not('status', 'in', '("settled","written_off")')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

  const [{ data: payments }, { data: messages }, { data: timeline }] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, currency, payment_date, status, reference_number, receipt_url, notes')
      .eq('company_id', params.company_id)
      .eq('customer_id', params.customer_id)
      .order('payment_date', { ascending: false })
      .limit(5),

    supabase
      .from('messages')
      .select('direction, channel, content, status, sent_at')
      .eq('company_id', params.company_id)
      .eq('customer_id', params.customer_id)
      .order('sent_at', { ascending: false })
      .limit(8),

    supabase
      .from('timeline_events')
      .select('event_type, title, description, occurred_at, metadata')
      .eq('company_id', params.company_id)
      .eq('customer_id', params.customer_id)
      .order('occurred_at', { ascending: false })
      .limit(8),
  ])

  return {
    customer: customer ?? null,
    debt: debt ?? null,
    recent_payments: payments ?? [],
    recent_messages: messages ?? [],
    recent_timeline: timeline ?? [],
    summary: {
      customer_name: customer?.full_name ?? 'Unknown',
      creditor_name: debt?.creditor_name ?? 'Unknown',
      product_type: debt?.product_type ?? 'Unknown',
      reference_number: debt?.reference_number ?? 'Unknown',
      current_balance: debt?.current_balance ?? null,
      currency: debt?.currency ?? 'SAR',
      debt_status: debt?.status ?? 'unknown',
      risk_level: customer?.risk_level ?? 'unknown',
      has_recent_payments: (payments?.length ?? 0) > 0,
      has_conversation_history: (messages?.length ?? 0) > 0,
    }
  }
}
