import { createServiceClient } from '@/lib/supabase/server'

export async function buildCustomerDebtContext(params: {
  company_id: string
  customer_id: string
  debt_id?: string | null
}) {
  const supabase = createServiceClient()

  const { data: customer } = await supabase
    .from('customers')
    .select('id, full_name, email, phone, whatsapp, national_id, city, country, employer, monthly_income, risk_level, tags, notes, metadata')
    .eq('id', params.customer_id)
    .eq('company_id', params.company_id)
    .maybeSingle()

  const debtQuery = supabase
    .from('debts')
    .select('id, reference_number, original_amount, current_balance, currency, status, priority, due_date, last_payment_date, next_follow_up, product_type, creditor_name, account_number, notes, metadata, created_at, portfolio:portfolios(name)')
    .eq('company_id', params.company_id)
    .eq('customer_id', params.customer_id)

  const { data: debt } = params.debt_id
    ? await debtQuery.eq('id', params.debt_id).maybeSingle()
    : await debtQuery
        .not('status', 'in', '("settled","written_off")')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

  const debtId = debt?.id ?? params.debt_id ?? null

  const [
    { data: payments },
    { data: messages },
    { data: timeline },
    { data: promises },
    { data: memory },
    { data: approvals },
    { data: alerts },
    { data: collectionFollowups },
    { data: statusHistory },
    { data: assignments },
    { data: attachments },
  ] = await Promise.all([
    supabase
      .from('payments')
      .select('amount, currency, payment_date, status, reference_number, receipt_url, notes')
      .eq('company_id', params.company_id)
      .eq('customer_id', params.customer_id)
      .order('payment_date', { ascending: false })
      .limit(8),

    supabase
      .from('messages')
      .select('direction, channel, content, status, sent_at, metadata')
      .eq('company_id', params.company_id)
      .eq('customer_id', params.customer_id)
      .order('sent_at', { ascending: false })
      .limit(12),

    supabase
      .from('timeline_events')
      .select('event_type, channel, summary, detail, actor_type, ai_used, occurred_at')
      .eq('company_id', params.company_id)
      .eq('customer_id', params.customer_id)
      .order('occurred_at', { ascending: false })
      .limit(12),

    debtId
      ? supabase
          .from('promises')
          .select('promised_amount, promised_date, status, channel, notes, created_at')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .eq('debt_id', debtId)
          .order('created_at', { ascending: false })
          .limit(5)
      : supabase
          .from('promises')
          .select('promised_amount, promised_date, status, channel, notes, created_at')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .order('created_at', { ascending: false })
          .limit(5),

    supabase
      .from('ai_memory')
      .select('trigger_pattern, response_text, category, success_rate, use_count, last_used_at, source, created_at')
      .eq('company_id', params.company_id)
      .eq('is_active', true)
      .order('use_count', { ascending: false })
      .limit(8),

    debtId
      ? supabase
          .from('approvals')
          .select('approval_type, status, priority, reason, created_at')
          .eq('company_id', params.company_id)
          .eq('entity_id', debtId)
          .order('created_at', { ascending: false })
          .limit(5)
      : supabase
          .from('approvals')
          .select('approval_type, status, priority, reason, created_at')
          .eq('company_id', params.company_id)
          .order('created_at', { ascending: false })
          .limit(5),

    supabase
      .from('system_alerts')
      .select('severity, alert_type, title, message, is_resolved, created_at')
      .eq('company_id', params.company_id)
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(5),

    debtId
      ? supabase
          .from('collection_followups')
          .select('followup_type, followup_channel, original_status, original_sub_status, normalized_status, collector_name, customer_statement, collector_note, result_summary, next_follow_up_at, occurred_at, raw_payload')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .eq('debt_id', debtId)
          .order('occurred_at', { ascending: false })
          .limit(30)
      : supabase
          .from('collection_followups')
          .select('followup_type, followup_channel, original_status, original_sub_status, normalized_status, collector_name, customer_statement, collector_note, result_summary, next_follow_up_at, occurred_at, raw_payload')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .order('occurred_at', { ascending: false })
          .limit(30),

    debtId
      ? supabase
          .from('collection_status_history')
          .select('old_status, old_sub_status, new_status, new_sub_status, normalized_status, changed_by_name, changed_at, raw_payload')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .eq('debt_id', debtId)
          .order('changed_at', { ascending: false })
          .limit(30)
      : supabase
          .from('collection_status_history')
          .select('old_status, old_sub_status, new_status, new_sub_status, normalized_status, changed_by_name, changed_at, raw_payload')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .order('changed_at', { ascending: false })
          .limit(30),

    debtId
      ? supabase
          .from('collection_assignments')
          .select('assigned_to_name, assigned_by_name, assignment_status, assigned_at, released_at, raw_payload')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .eq('debt_id', debtId)
          .order('assigned_at', { ascending: false })
          .limit(20)
      : supabase
          .from('collection_assignments')
          .select('assigned_to_name, assigned_by_name, assignment_status, assigned_at, released_at, raw_payload')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .order('assigned_at', { ascending: false })
          .limit(20),

    debtId
      ? supabase
          .from('collection_attachments')
          .select('attachment_type, file_name, file_url, mime_type, uploaded_by_name, uploaded_at, description')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .eq('debt_id', debtId)
          .order('uploaded_at', { ascending: false })
          .limit(20)
      : supabase
          .from('collection_attachments')
          .select('attachment_type, file_name, file_url, mime_type, uploaded_by_name, uploaded_at, description')
          .eq('company_id', params.company_id)
          .eq('customer_id', params.customer_id)
          .order('uploaded_at', { ascending: false })
          .limit(20),
  ])

  const openPromises = (promises ?? []).filter((p: any) => p.status === 'pending')
  const brokenPromises = (promises ?? []).filter((p: any) => p.status === 'broken')
  const completedPayments = (payments ?? []).filter((p: any) => p.status === 'completed')
  const inboundMessages = (messages ?? []).filter((m: any) => m.direction === 'inbound')
  const lastInbound = inboundMessages[0] ?? null
  const lastOutbound = (messages ?? []).find((m: any) => m.direction === 'outbound') ?? null

  const allCustomerText = inboundMessages.map((m: any) => String(m.content ?? '')).join(' ').toLowerCase()
  const angryWords = ['غصب', 'ازعاج', 'ازعجتوني', 'طفشتوني', 'بلاغ', 'محامي', 'شكوى', 'court', 'lawyer', 'complaint']
  const refusalWords = ['ما بسدد', 'ماراح اسدد', 'ما راح اسدد', 'لن اسدد', 'رفض', 'not paying', "won't pay"]
  const paidWords = ['سددت', 'دفعت', 'حولت', 'ايصال', 'إيصال', 'paid', 'receipt', 'transfer']
  const promiseWords = ['بسدد', 'اسدد', 'الخميس', 'بكرة', 'بكره', 'نهاية الشهر', 'راتب', 'salary', 'tomorrow']

  const isAngry = angryWords.some(w => allCustomerText.includes(w))
  const isRefusing = refusalWords.some(w => allCustomerText.includes(w))
  const hasPaidClaim = paidWords.some(w => allCustomerText.includes(w))
  const hasPromiseSignals = promiseWords.some(w => allCustomerText.includes(w))

  const behaviorType =
    brokenPromises.length >= 2 ? 'procrastinator' :
    isAngry ? 'angry' :
    isRefusing ? 'refusing' :
    completedPayments.length > 0 || openPromises.length > 0 ? 'cooperative' :
    hasPaidClaim ? 'payment_claim' :
    hasPromiseSignals ? 'promise_signal' :
    'unknown'

  const recommendedStrategy =
    behaviorType === 'angry' ? 'calm_verify_then_redirect' :
    behaviorType === 'refusing' ? 'understand_reason_then_negotiate' :
    behaviorType === 'procrastinator' ? 'firm_commitment_with_specific_date' :
    behaviorType === 'cooperative' ? 'confirm_next_step_and_close' :
    behaviorType === 'payment_claim' ? 'ask_receipt_and_verify' :
    behaviorType === 'promise_signal' ? 'confirm_amount_and_date' :
    'identify_customer_and_context'

  const negotiation_profile = {
    behavior_type: behaviorType,
    recommended_strategy: recommendedStrategy,
    broken_promises_count: brokenPromises.length,
    open_promises_count: openPromises.length,
    completed_payments_count: completedPayments.length,
    has_angry_language: isAngry,
    has_refusal_language: isRefusing,
    has_payment_claim: hasPaidClaim,
    has_promise_signal: hasPromiseSignals,
    conversation_depth: messages?.length ?? 0,
    guidance: [
      'Do not use generic customer-service openings.',
      'Use the customer history before asking a new question.',
      'Ask only one useful question when needed.',
      'If enough debt context exists, give a clear debt-specific answer.',
      'If the customer has broken promises, be firmer and ask for a specific date/amount.',
      'If the customer is angry, acknowledge briefly then move to verification or solution.',
    ],
  }

  return {
    // ══════════════════════════════════════════════════════════════
    // ⛔ STRICT RULES — MUST be injected into the AI prompt
    // ══════════════════════════════════════════════════════════════
    strict_rules: [
      'أنت خالد، محصّل ديون سعودي محترف. عمرك 45 سنة.',
      '⛔ ممنوع منعاً باتاً اختراع أو تخمين أي بيانات غير موجودة في هذا السياق.',
      '⛔ إذا كانت أي قيمة "غير محدد" أو null، لا تذكرها أبداً في ردك ولا تخترع بديلاً لها.',
      '⛔ لا تذكر اسم أي شركة أو مؤسسة إلا إذا كانت موجودة بالضبط في حقل creditor_name أو employer.',
      '⛔ لا تذكر أي مبلغ إلا المبلغ الموجود في حقل current_balance بالضبط.',
      '⛔ لا تخترع أرقام مرجعية أو أرقام حسابات أو تواريخ غير موجودة.',
      '⛔ إذا سألك العميل عن معلومة غير موجودة في السياق، قل "ما عندي هالمعلومة حالياً، بتواصل مع الإدارة وأرد عليك".',
      '⛔ ممنوع منعاً باتاً أن توافق على تقسيط أو تقترح مبلغاً شهرياً أو عدد دفعات أو أي سداد جزئي ما لم يكن هناك تقسيط معتمد فعلاً في النظام. أي تقسيط جديد يحتاج موافقة الإدارة، ومهمتك فقط رفع الطلب لا الموافقة عليه.',
      'استخدم اللهجة السعودية البيضاء. كن مهنياً ومختصراً.',
      'لا ترسل أكثر من جملتين في الرد الواحد.',
    ],

    // ══════════════════════════════════════════════════════════════
    // 📋 VERIFIED DATA — Only these values are real
    // ══════════════════════════════════════════════════════════════
    verified_customer_data: {
      customer_name: customer?.full_name || null,
      phone: customer?.phone || null,
      whatsapp: customer?.whatsapp || null,
      national_id: customer?.national_id || null,
      employer: customer?.employer || null,
      city: customer?.city || null,
      risk_level: customer?.risk_level || null,
    },

    verified_debt_data: {
      reference_number: debt?.reference_number || null,
      account_number: debt?.account_number || null,
      creditor_name: debt?.creditor_name || null,
      product_type: debt?.product_type || null,
      original_amount: debt?.original_amount ?? null,
      current_balance: debt?.current_balance ?? null,
      currency: debt?.currency || 'SAR',
      status: debt?.status || null,
      priority: debt?.priority || null,
      due_date: debt?.due_date || null,
      last_payment_date: debt?.last_payment_date || null,
      portfolio_name: (debt as any)?.portfolio?.name || null,
      notes: debt?.notes || null,
    },

    customer: customer ?? null,
    debt: debt ?? null,
    recent_payments: payments ?? [],
    recent_messages: messages ?? [],
    recent_timeline: timeline ?? [],
    recent_promises: promises ?? [],
    ai_memory: memory ?? [],
    recent_approvals: approvals ?? [],
    active_alerts: alerts ?? [],
    collection_history: {
      followups: collectionFollowups ?? [],
      status_history: statusHistory ?? [],
      assignments: assignments ?? [],
      attachments: attachments ?? [],
    },
    latest_collection_context: {
      last_followup: collectionFollowups?.[0] ?? null,
      last_status_change: statusHistory?.[0] ?? null,
      current_assignment: assignments?.[0] ?? null,
      attachments_count: attachments?.length ?? 0,
    },
    conversation_profile: {
      has_history: (messages?.length ?? 0) > 0,
      last_customer_message: lastInbound?.content ?? null,
      last_ai_reply: lastOutbound?.content ?? null,
      open_promises_count: openPromises.length,
      completed_payments_count: completedPayments.length,
      customer_risk_level: customer?.risk_level ?? null,
      debt_status: debt?.status ?? null,
      debt_priority: debt?.priority ?? null,
      should_be_careful: ['disputed', 'legal'].includes(String(debt?.status ?? '')),
    },
    negotiation_profile,
    summary: {
      customer_name: customer?.full_name ?? null,
      phone: customer?.phone ?? null,
      whatsapp: customer?.whatsapp ?? null,
      national_id: customer?.national_id ?? null,
      portfolio_name: (debt as any)?.portfolio?.name ?? null,
      creditor_name: debt?.creditor_name ?? null,
      product_type: debt?.product_type ?? null,
      reference_number: debt?.reference_number ?? null,
      account_number: debt?.account_number ?? null,
      current_balance: debt?.current_balance ?? null,
      original_amount: debt?.original_amount ?? null,
      currency: debt?.currency ?? 'SAR',
      debt_status: debt?.status ?? null,
      debt_priority: debt?.priority ?? null,
      due_date: debt?.due_date ?? null,
      last_payment_date: debt?.last_payment_date ?? null,
      risk_level: customer?.risk_level ?? null,
      has_recent_payments: (payments?.length ?? 0) > 0,
      has_conversation_history: (messages?.length ?? 0) > 0,
      has_open_promise: openPromises.length > 0,
      has_active_alerts: (alerts?.length ?? 0) > 0,
    }
  }
}

