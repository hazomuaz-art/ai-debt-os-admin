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

function safeText(v: unknown) {
  return String(v ?? '').trim()
}

export async function processDebtAutomation(input: ProcessDebtInput) {
  const { supabase, company_id, debt_id, customer_id, source = 'automation_core' } = input

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
  const currency = debt.currency ?? 'SAR'

  async function addTimeline(event_type: string, title: string, description: string, metadata: Record<string, unknown> = {}) {
    try {
      await supabase.from('timeline_events').insert({
        company_id,
        customer_id,
        debt_id,
        event_type,
        title,
        description,
        source,
        metadata,
      })
    } catch {}
  }

  if (['settled', 'written_off'].includes(status) || balance <= 0) {
    await addTimeline('automation_skipped', 'Automation skipped', 'Debt is settled, written off, or zero balance.', { status, balance })
    return { ok: true, skipped: true }
  }

  const days_overdue = debt.due_date
    ? Math.max(0, Math.floor((Date.now() - new Date(debt.due_date).getTime()) / 86400000))
    : 0

  const score = scoringFallback({
    debt: { ...debt, original_amount: original, current_balance: balance, currency },
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
  const today = new Date().toISOString().split('T')[0]

  if (action_type) {
    await supabase
      .from('ai_actions')
      .delete()
      .eq('company_id', company_id)
      .eq('debt_id', debt_id)
      .eq('scheduled_for', today)
      .eq('status', 'pending')

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
      reason: `${status} case, balance ${balance} ${currency}`,
      suggested_message: `السلام عليكم ${safeText(customer.full_name)}، بخصوص المبلغ المستحق ${balance} ${currency}، نرجو التواصل معنا لترتيب السداد أو تزويدنا بإيصال السداد إن تم الدفع.`,
      best_time_to_contact: '10:00 AM - 12:00 PM',
      scheduled_for: today,
      scheduled_date: today,
      status: 'pending',
    })
  }

  await supabase.from('ai_memory').insert({
    company_id,
    trigger_pattern: `${status} ${safeText(debt.product_type)} ${safeText(customer.full_name)}`.slice(0, 200),
    response_text: `Customer ${safeText(customer.full_name)} has ${status} debt with balance ${balance} ${currency}. Recommended strategy: ${score.recommended_strategy}`.slice(0, 1000),
    category: 'customer_context',
    status: 'approved',
    is_active: true,
    source,
    success_count: 0,
    use_count: 0,
  }).catch?.(() => {})

  await addTimeline('automation_processed', 'Automation processed debt', 'AI score, action, risk level, memory, and timeline generated automatically.', {
    status,
    balance,
    score: score.score,
    risk: score.risk_classification,
    action_type,
  })

  return { ok: true, score: score.score, risk: score.risk_classification, action_type }
}


