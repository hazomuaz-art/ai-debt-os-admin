import { createServiceClient } from '@/lib/supabase/server'

// ════════════════════════════════════════════════════════════════════
//  Customer 360 Context Engine — Phase 1
//
//  Reads EVERY data source in the system that belongs to a customer (not
//  just the single "latest active debt" the legacy buildCustomerDebtContext
//  picks) and groups the customer's debts by portfolio so the agent can:
//   - list every claim under the same company instead of picking one
//   - ask which company is meant when the customer has debts under
//     different, unrelated portfolios
//
//  This module does NOT decide what to say — it only assembles facts and
//  exposes a deterministic (non-LLM) gate + grouping decision. The actual
//  reply is still produced by runCollectorAgent in ai-collector-agent.ts.
// ════════════════════════════════════════════════════════════════════

export type DebtGroup = {
  portfolio_id: string | null
  portfolio_name: string | null
  portfolio_category: string | null
  company_key: string | null
  debts: any[]
}

export type Customer360Context = {
  customer: any
  debtGroups: DebtGroup[]
  allDebts: any[]
  allPayments: any[]
  allMessages: any[]
  allPromises: any[]
  allTimeline: any[]
  allApprovals: any[]
  allDisputes: any[]
  allAttachments: any[]
  allFollowups: any[]
  allStatusHistory: any[]
  allAssignments: any[]
  alerts: any[]
  collectionAccounts: any[]
  customerDataByPortfolio: Record<string, any[]>
}

export async function buildCustomer360Context(params: {
  company_id: string
  customer_id: string
}): Promise<Customer360Context> {
  const supabase = createServiceClient()

  const { data: customer } = await supabase
    .from('customers')
    .select('id, full_name, email, phone, whatsapp, national_id, city, country, employer, monthly_income, risk_level, tags, notes, metadata')
    .eq('id', params.customer_id)
    .eq('company_id', params.company_id)
    .maybeSingle()

  // ALL debts (no .limit(1), no status filter) — the core fix for the
  // "one debt picked, the rest ignored" structural bug.
  const { data: debts } = await supabase
    .from('debts')
    .select('id, portfolio_id, reference_number, original_amount, current_balance, currency, status, priority, due_date, last_payment_date, next_follow_up, product_type, creditor_name, account_number, notes, metadata, created_at, portfolio:portfolios(id, name, category, metadata)')
    .eq('company_id', params.company_id)
    .eq('customer_id', params.customer_id)
    .order('created_at', { ascending: false })

  // approvals has no customer_id/debt_id columns — only company_id +
  // entity_type/entity_id (see src/lib/approvals.ts) — so this customer's
  // approvals must be looked up via their debt IDs, not a direct filter.
  // Root-cause fix (2026-07-13): this queried nonexistent `approvals.debt_id`
  // and `approvals.reason` columns and filtered on a nonexistent
  // `approvals.customer_id` column, so the query failed on every single call
  // (confirmed via repeated "column approvals.reason/debt_id does not exist"
  // errors in production Postgres logs) — allApprovals was silently always
  // empty for the AI agent's customer-360 context.
  const debtIds = (debts ?? []).map(d => d.id)

  const [
    { data: payments },
    { data: messages },
    { data: promises },
    { data: timeline },
    { data: approvals },
    { data: disputes },
    { data: attachments },
    { data: followups },
    { data: statusHistory },
    { data: assignments },
    { data: collAccounts },
    { data: alerts },
  ] = await Promise.all([
    supabase.from('payments').select('debt_id, amount, currency, payment_date, status, reference_number, receipt_url, notes')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('payment_date', { ascending: false }),

    supabase.from('messages').select('direction, channel, content, status, sent_at, metadata')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('sent_at', { ascending: false }),

    supabase.from('promises').select('debt_id, promised_amount, promised_date, status, channel, notes, created_at')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('created_at', { ascending: false }),

    supabase.from('timeline_events').select('event_type, channel, summary, detail, actor_type, ai_used, occurred_at')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('occurred_at', { ascending: false }),

    debtIds.length
      ? supabase.from('approvals').select('entity_id, approval_type, status, priority, description, created_at')
          .eq('company_id', params.company_id).eq('entity_type', 'debt').in('entity_id', debtIds).order('created_at', { ascending: false })
      : Promise.resolve({ data: [] as any[] }),

    // `disputes` is a dedicated table the agent never read before Phase 1 —
    // dispute status was only inferred from `approvals`. Both are now read.
    supabase.from('disputes').select('debt_id, dispute_type, description, status, priority, resolution, created_at')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('created_at', { ascending: false }),

    supabase.from('collection_attachments').select('debt_id, attachment_type, file_name, file_url, mime_type, uploaded_by_name, uploaded_at, description')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('uploaded_at', { ascending: false }),

    supabase.from('collection_followups').select('debt_id, followup_type, followup_channel, original_status, original_sub_status, normalized_status, collector_name, customer_statement, collector_note, result_summary, next_follow_up_at, occurred_at')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('occurred_at', { ascending: false }),

    supabase.from('collection_status_history').select('debt_id, old_status, old_sub_status, new_status, new_sub_status, normalized_status, changed_by_name, changed_at')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('changed_at', { ascending: false }),

    supabase.from('collection_assignments').select('debt_id, assigned_to_name, assigned_by_name, assignment_status, assigned_at, released_at')
      .eq('company_id', params.company_id).eq('customer_id', params.customer_id).order('assigned_at', { ascending: false }),

    supabase.from('collection_accounts').select('method_type, iban, account_name, bank_name, biller_code, biller_name, instructions, portfolio_id')
      .eq('company_id', params.company_id).eq('is_active', true),

    // system_alerts has no customer_id column — best-effort filter via the
    // jsonb metadata field, which is where customer-scoped alerts store it.
    supabase.from('system_alerts').select('severity, alert_type, title, message, metadata, is_resolved, created_at')
      .eq('company_id', params.company_id).eq('is_resolved', false)
      .filter('metadata->>customer_id', 'eq', params.customer_id)
      .order('created_at', { ascending: false }).limit(10),
  ])

  // Group debts by portfolio. Debts with no portfolio share the
  // 'no_portfolio' bucket — they are NOT distinct companies from each
  // other, only from named portfolios.
  const groups = new Map<string, DebtGroup>()
  for (const d of debts ?? []) {
    const key = (d as any).portfolio_id ?? 'no_portfolio'
    if (!groups.has(key)) {
      groups.set(key, {
        portfolio_id: (d as any).portfolio_id ?? null,
        portfolio_name: (d as any).portfolio?.name ?? null,
        portfolio_category: (d as any).portfolio?.category ?? null,
        company_key: (d as any).portfolio?.metadata?.company_key ?? null,
        debts: [],
      })
    }
    groups.get(key)!.debts.push(d)
  }
  const debtGroups = [...groups.values()]

  // Portfolio-specific customer_data_<company_key> rows — best effort: many
  // portfolios (manual, no import profile) have no matching table at all,
  // which must not break the whole context fetch.
  const customerDataByPortfolio: Record<string, any[]> = {}
  await Promise.all(debtGroups.map(async (g) => {
    if (!g.company_key) return
    try {
      const { data, error } = await supabase
        .from(`customer_data_${g.company_key}`)
        .select('*')
        .eq('customer_id', params.customer_id)
      if (!error && data) customerDataByPortfolio[g.portfolio_id ?? 'no_portfolio'] = data
    } catch {
      // table doesn't exist for this portfolio — safe to skip
    }
  }))

  return {
    customer: customer ?? null,
    debtGroups,
    allDebts: debts ?? [],
    allPayments: payments ?? [],
    allMessages: messages ?? [],
    allPromises: promises ?? [],
    allTimeline: timeline ?? [],
    allApprovals: approvals ?? [],
    allDisputes: disputes ?? [],
    allAttachments: attachments ?? [],
    allFollowups: followups ?? [],
    allStatusHistory: statusHistory ?? [],
    allAssignments: assignments ?? [],
    alerts: alerts ?? [],
    collectionAccounts: collAccounts ?? [],
    customerDataByPortfolio,
  }
}

// ════════════════════════════════════════════════════════════════════
//  Debt-related intent gate — the company-clarification question is only
//  ever asked when the customer's CURRENT message is actually about a debt
//  (amount, details, payment, dispute, receipt, account number). A greeting,
//  "من أنت؟", or general chit-chat must never trigger it.
// ════════════════════════════════════════════════════════════════════

// Short, ambiguous tokens ("كم" alone is a substring of "عليكم"/"إليكم" etc.)
// must match as a WHOLE WORD, never as a substring — otherwise an ordinary
// greeting ("السلام عليكم") would wrongly trigger the company-clarification
// gate. Longer/specific phrases are safe to match as substrings.
const DEBT_RELATED_WHOLE_WORDS = ['كم', 'حول']
const DEBT_RELATED_PHRASES = [
  'قديش', 'مبلغ', 'الرصيد', 'باقي علي', 'باقي عليه', 'المديونية', 'الدين', 'ديوني',
  'تفاصيل', 'التفاصيل', 'وضح لي',
  'سدد', 'اسدد', 'ادفع', 'أدفع', 'دفعت', 'حولت', 'تحويل', 'وين احول', 'وين أحول',
  'اعتراض', 'معترض', 'غلط', 'مو صحيح', 'مش صحيح',
  'ايصال', 'إيصال', 'receipt',
  'رقم الحساب', 'رقم العقد', 'رقم الملف', 'الحساب', 'العقد',
  'آيبان', 'ايبان', 'iban', 'مفوتر', 'سداد',
]

export function isDebtRelatedMessage(text: string): boolean {
  const v = String(text ?? '').trim().toLowerCase()
  if (!v) return false
  const words = v.split(/\s+/)
  if (DEBT_RELATED_WHOLE_WORDS.some(w => words.includes(w))) return true
  return DEBT_RELATED_PHRASES.some(w => v.includes(w.toLowerCase()))
}

// ════════════════════════════════════════════════════════════════════
//  Multi-debt resolution — never silently pick one debt and ignore the
//  rest. Same portfolio → list all claims. Different portfolios → ask
//  which company is meant, deterministically, with zero LLM call.
// ════════════════════════════════════════════════════════════════════

export type DebtSelection =
  | { mode: 'single'; group?: DebtGroup }
  | { mode: 'same_portfolio'; group: DebtGroup }
  | { mode: 'needs_clarification'; groups: DebtGroup[] }
  | { mode: 'clarified'; group: DebtGroup }

export function selectDebtGroup(groups: DebtGroup[], text: string): DebtSelection {
  if (groups.length === 0) return { mode: 'single' }
  if (groups.length === 1) {
    return groups[0].debts.length > 1
      ? { mode: 'same_portfolio', group: groups[0] }
      : { mode: 'single', group: groups[0] }
  }

  // Multiple portfolios — try to resolve directly from the customer's own
  // current message before asking them to repeat themselves.
  const v = String(text ?? '').trim().toLowerCase()
  const matched = groups.filter(g => g.portfolio_name && v.includes(g.portfolio_name.toLowerCase()))
  if (matched.length === 1) {
    return matched[0].debts.length > 1
      ? { mode: 'same_portfolio', group: matched[0] }
      : { mode: 'clarified', group: matched[0] }
  }
  return { mode: 'needs_clarification', groups }
}

export function pickPrimaryDebt(debts: any[]): any | null {
  return debts.find((d: any) => !['settled', 'written_off'].includes(String(d.status))) ?? debts[0] ?? null
}

export function mapDebtForList(d: any) {
  return {
    id: d.id,
    reference_number: d.reference_number ?? null,
    account_number: d.account_number ?? null,
    current_balance: d.current_balance ?? null,
    original_amount: d.original_amount ?? null,
    currency: d.currency || 'SAR',
    status: d.status ?? null,
    due_date: d.due_date ?? null,
    product_type: d.product_type ?? null,
  }
}
