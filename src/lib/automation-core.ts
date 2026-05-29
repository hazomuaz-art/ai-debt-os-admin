import { scoringFallback } from '@/lib/ai-engine'

type SupabaseAny = any

type ProcessDebtInput = {
  supabase: SupabaseAny
  company_id: string
  debt_id: string
  customer_id: string
  user_id?: string | null
  source?: string
}

function mapActionType(status: string, hasWhatsapp: boolean, hasPhone: boolean) {
  if (status === 'settled' || status === 'written_off') return null
  if (status === 'legal') return 'legal'
  if (status === 'disputed') return 'review'
  if (hasWhatsapp) return 'whatsapp'
  if (hasPhone) return 'call'
  return 'email'
}

export async function processDebtAutomation(input: ProcessDebtInput) {
  const { supabase, company_id, debt_id, customer_id, user_id = null, source = 'automation_core' } = input

  const { data: debt } = await supabase
    .from('debts')
    .select('*')
    .eq('id', debt_id)
    .eq('company_id', company_id)
    .maybeSingle()

  const { data: customer } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .maybeSingle()

  if (!debt || !customer) return { ok: false, reason: 'missing debt or customer' }

  const status = String(debt.status ?? 'active')
  const balance = Number(debt.current_balance ?? 0)
  const original = Number(debt.original_amount ?? balance)

  if (['settled', 'written_off'].includes(status) || balance <= 0) {
    await supabase.from('timeline_events').insert({
      company_id,
      customer_id,
      debt_id,
      event_type: 'automation_skipped',
      title: 'Automation skipped',
      description: 'Debt is settled, written off, or has zero balance.',
      source,
      metadata: { status, balance },
    }).catch?.(() => {})
    return { ok: true, skipped: true }
  }

  const days_overdue = debt.due_date
    ? Math.max(0, Math.floor((Date.now() - new Date(debt.due_date).getTime()) / 86400000))
    : 0

  const score = scoringFallback({
    debt: {
      ...debt,
      original_amount: original,
      current_balance: balance,
      currency: debt.currency ?? 'SAR',
    },
    customer,
    payment_history: [],
    days_overdue,
    total_payments_made: 0,
  } as any)

  await supabase.from('ai_scores').insert({
    company_id,
    debt_id,
    score: score.score,
    risk_classification: score.risk_classification,
    collection_probability: score.collection_probability,
    recommended_strategy: score.recommended_strategy,
    factors: score.factors,
  })

  await supabase
    .from('customers')
    .update({ risk_level: score.risk_classification })
    .eq('id', customer_id)
    .eq('company_id', company_id)

  const hasWhatsapp = !!(customer.whatsapp || customer.phone)
  const hasPhone = !!customer.phone
  const action_type = mapActionType(status, hasWhatsapp, hasPhone)

  if (action_type) {
    const today = new Date().toISOString().split('T')[0]
    const priority =
      score.risk_classification === 'critical' ? 'critical' :
      score.risk_classification === 'high' ? 'high' :
      balance >= 8000 ? 'high' : 'medium'

    await supabase.from('ai_actions').insert({
      company_id,
      debt_id,
      customer_id,
      assigned_to: debt.assigned_to ?? null,
      action_type,
      priority,
      priority_score: priority === 'critical' ? 100 : priority === 'high' ? 75 : 50,
      reason: `${status} case, balance ${balance} ${debt.currency ?? 'SAR'}`,
      suggested_message: `السلام عليكم ${customer.full_name ?? ''}، بخصوص المبلغ المستحق ${balance} ${debt.currency ?? 'SAR'}، نرجو التواصل معنا لترتيب السداد أو تزويدنا بإيصال السداد إن تم الدفع.`,
      best_time_to_contact: '10:00 AM - 12:00 PM',
      scheduled_for: today,
      scheduled_date: today,
      status: 'pending',
    })
  }

  await supabase.from('timeline_events').insert({
    company_id,
    customer_id,
    debt_id,
    event_type: 'automation_processed',
    title: 'Automation processed debt',
    description: 'AI score, action plan, risk level, and timeline were generated automatically.',
    source,
    metadata: {
      status,
      balance,
      score: score.score,
      risk: score.risk_classification,
      action_type,
    },
  })

  return { ok: true, score: score.score, risk: score.risk_classification, action_type }
}
