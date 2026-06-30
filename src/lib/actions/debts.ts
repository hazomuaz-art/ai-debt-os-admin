'use server'

import { createClient } from '@/lib/supabase/server'
import { generateReferenceNumber } from '@/lib/utils'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { DebtStatus, DebtPriority } from '@/types'
import { createLogger } from '@/lib/logger'
import { trackDebtCreated, trackCustomerCreated } from '@/lib/usage-tracker'
import { processEvent } from '@/lib/automation-pipeline'
import { recordAttribution } from '@/lib/revenue-attribution'
import { upsertPortfolioCustomerData } from '@/lib/portfolio-customer-data'
import { getPortfolioTableConfig } from '@/lib/portfolio-data-fields'
const log = createLogger('actions/debts')

// ============================================================
// Schemas
// ============================================================

const createCustomerSchema = z.object({
  full_name:      z.string().min(2).max(200),
  email:          z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  phone:          z.string().max(30).optional(),
  whatsapp:       z.string().max(30).optional(),
  national_id:    z.string().max(50).optional(),
  city:           z.string().max(100).optional(),
  employer:       z.string().max(200).optional(),
  monthly_income: z.coerce.number().min(0).optional(),
  notes:          z.string().max(1000).optional(),
  address:        z.string().max(500).optional(),
})

const createDebtSchema = z.object({
  customer_id:     z.string().uuid(),
  original_amount: z.coerce.number().positive(),
  current_balance: z.coerce.number().min(0).optional(),
  interest_rate:   z.coerce.number().min(0).max(100).default(0),
  currency:        z.string().default('SAR'),
  status:          z.string().default('active'),
  priority:        z.string().default('medium'),
  due_date:        z.string().optional(),
  product_type:    z.string().max(100).optional(),
  creditor_name:   z.string().max(200).optional(),
  account_number:  z.string().max(100).optional(),
  assigned_to:     z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
  notes:           z.string().max(1000).optional(),
  portfolio_id:    z.string().uuid().optional().or(z.literal('')).transform(v => v || undefined),
})

// ============================================================
// Auth helper
// ============================================================

async function requireAuth() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role, is_active')
    .eq('id', user.id)
    .single()

  if (!profile?.is_active) throw new Error('Account is disabled')
  if (!profile?.company_id) throw new Error('No company associated')

  return { supabase, user, profile }
}

// ============================================================
// Customer actions
// ============================================================

export async function createCustomerAction(formData: FormData) {
  try {
    const { supabase, user, profile } = await requireAuth()

    const raw    = Object.fromEntries(formData.entries())
    const parsed = createCustomerSchema.safeParse(raw)
    if (!parsed.success) {
      return { error: parsed.error.errors[0].message }
    }

    // Check for duplicate national_id or phone within company
    if (parsed.data.national_id) {
      const { data: existing } = await supabase
        .from('customers')
        .select('id, full_name')
        .eq('company_id', profile.company_id)
        .eq('national_id', parsed.data.national_id)
        .single()

      if (existing) {
        return { error: `Customer with this National ID already exists: ${existing.full_name}` }
      }
    }

    const { data, error } = await supabase
      .from('customers')
      .insert({
        ...parsed.data,
        email:      parsed.data.email || null,
        company_id: profile.company_id,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) return { error: error.message }

    // Portfolio-specific fields (المحفظة dropdown + dynamic fields, named
    // pf_<column> by PortfolioFieldsSection) — same tables the importer
    // routes data into.
    const portfolioId = (raw.portfolio_id as string | undefined) || null
    const companyKey  = (raw.company_key as string | undefined) || null
    if (companyKey && getPortfolioTableConfig(companyKey)) {
      const config = getPortfolioTableConfig(companyKey)!
      const payload: Record<string, unknown> = {}
      for (const field of config.fields) {
        const val = raw[`pf_${field.column}`]
        if (typeof val === 'string' && val.trim()) {
          payload[field.column] = field.type === 'number' ? parseFloat(val) : val.trim()
        }
      }
      if (Object.keys(payload).length > 0) {
        await upsertPortfolioCustomerData(supabase, {
          companyKey, companyId: profile.company_id, customerId: data.id,
          portfolioId, payload,
        })
      }
    }

    revalidatePath('/dashboard/admin/customers')
    revalidatePath('/dashboard/manager/customers')
    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ============================================================
// Debt actions
// ============================================================

export async function createDebtAction(formData: FormData) {
  try {
    const { supabase, user, profile } = await requireAuth()

    if (!['admin', 'manager'].includes(profile.role)) {
      return { error: 'Insufficient permissions' }
    }

    const raw    = Object.fromEntries(formData.entries())
    const parsed = createDebtSchema.safeParse(raw)
    if (!parsed.success) {
      return { error: parsed.error.errors[0].message }
    }

    // Verify customer belongs to this company
    const { data: customer } = await supabase
      .from('customers')
      .select('id')
      .eq('id', parsed.data.customer_id)
      .eq('company_id', profile.company_id)
      .single()

    if (!customer) return { error: 'Customer not found' }

    const reference_number = generateReferenceNumber()

    const { data, error } = await supabase
      .from('debts')
      .insert({
        ...parsed.data,
        current_balance: parsed.data.current_balance ?? parsed.data.original_amount,
        assigned_to:     parsed.data.assigned_to || null,
        due_date:        parsed.data.due_date || null,
        product_type:    parsed.data.product_type || null,
        account_number:  parsed.data.account_number || null,
        notes:           parsed.data.notes || null,
        company_id:      profile.company_id,
        reference_number,
        created_by:      user.id,
      })
      .select('*, customer:customers(id, full_name)')
      .single()

    if (error) {
      if (error.code === '23505') return { error: 'Reference number conflict â€” please try again' }
      return { error: error.message }
    }

    // Auto-assign the debt to a portfolio based on its creditor — skipped
    // when the user already picked a portfolio explicitly via the dropdown.
    if (data && !parsed.data.portfolio_id && parsed.data.creditor_name) {
      const portfolioId = await ensurePortfolioForCreditor(supabase, profile.company_id, parsed.data.creditor_name)
      if (portfolioId) {
        await supabase.from('debts').update({ portfolio_id: portfolioId }).eq('id', data.id)
      }
    }

    // Enqueue background AI scoring (non-fatal â€” function may not exist yet)
    try {
      await supabase.rpc('enqueue_job', {
        p_company_id: profile.company_id,
        p_job_type:   'score_debt',
        p_payload:    { debt_id: data.id },
        p_priority:   5,
        p_created_by: user.id,
        p_delay:      '30 seconds',
      })
    } catch (err) {
      log.warn('Failed to enqueue AI score job', { error: String(err) })
    }

    // Track usage (non-blocking)
    if (data) {
      trackDebtCreated({ company_id: profile.company_id, user_id: user.id, debt_id: data.id }).catch(() => {})
      // Trigger automation pipeline for new debt (awaited - server actions are not affected by Vercel timeout)
      try {
        await processEvent({
          source:       'debt_update',
          company_id:   profile.company_id,
          actor_id:     user.id,
          _customer_id: data.customer_id,
          _debt_id:     data.id,
          data:         { action: 'created' },
        })
      } catch { /* non-critical */ }
    }

    revalidatePath('/dashboard/admin/debts')
    revalidatePath('/dashboard/manager/debts')
    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Pause/resume the AI agent for a customer (pausing = hand off to a human).
export async function setCustomerAiPausedAction(customerId: string, paused: boolean) {
  try {
    const { supabase, profile } = await requireAuth()
    const { error } = await supabase
      .from('customers')
      .update({ ai_paused: paused })
      .eq('id', customerId)
      .eq('company_id', profile.company_id)
    if (error) return { error: error.message }
    revalidatePath('/dashboard/admin/debts')
    revalidatePath('/dashboard/admin/messages')
    revalidatePath(`/dashboard/admin/debts`)
    return { ok: true, paused }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Permanently deletes a customer + all their debts/data (conversation archived first).
export async function deleteCustomerFullyAction(customerId: string) {
  try {
    const { supabase, profile } = await requireAuth()
    if (!['admin', 'manager'].includes(profile.role)) return { error: 'صلاحيات غير كافية' }

    const { data: customer } = await supabase
      .from('customers').select('id')
      .eq('id', customerId).eq('company_id', profile.company_id).maybeSingle()
    if (!customer) return { error: 'العميل غير موجود' }

    const { error } = await supabase.rpc('delete_customer_fully', { p_customer_id: customerId })
    if (error) return { error: error.message }

    revalidatePath('/dashboard/admin/debts')
    revalidatePath('/dashboard/admin/messages')
    return { ok: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Ensures a portfolio exists for a creditor (per company) and returns its id.
export async function ensurePortfolioForCreditor(supabase: any, companyId: string, creditor: string): Promise<string | null> {
  const name = creditor.trim()
  if (!name) return null
  const { data: existing } = await supabase
    .from('portfolios').select('id')
    .eq('company_id', companyId).eq('name', name).maybeSingle()
  if (existing) return existing.id
  const { data: created } = await supabase
    .from('portfolios')
    .insert({ company_id: companyId, name, name_ar: name, is_active: true, source_system: 'auto_creditor' })
    .select('id').single()
  return created?.id ?? null
}

// Unified "case" creation: creates the customer then their debt in one step.
export async function createCaseAction(formData: FormData) {
  const cust = await createCustomerAction(formData)
  if (cust.error || !cust.data) return { error: cust.error || 'تعذّر إنشاء العميل' }

  formData.set('customer_id', (cust.data as { id: string }).id)
  const debt = await createDebtAction(formData)
  if (debt.error) {
    return { error: `تم إنشاء العميل لكن تعذّر إنشاء الدين: ${debt.error}` }
  }
  return { data: { customer: cust.data, debt: debt.data } }
}

export async function updateDebtStatusAction(debtId: string, status: DebtStatus) {
  try {
    const { supabase, user, profile } = await requireAuth()

    const validStatuses: DebtStatus[] = [
      'active', 'in_progress', 'promised', 'partial',
      'in_negotiation', 'payment_plan',
      'settled', 'written_off', 'legal', 'disputed',
    ]
    if (!validStatuses.includes(status)) {
      return { error: 'Invalid status' }
    }

    // Verify debt belongs to company (RLS also enforces)
    const { data: existing } = await supabase
      .from('debts')
      .select('id, status, company_id')
      .eq('id', debtId)
      .eq('company_id', profile.company_id)
      .single()

    if (!existing) return { error: 'Debt not found' }

    // Prevent unsettling a settled debt (requires admin)
    if (existing.status === 'settled' && status !== 'settled' && profile.role !== 'admin') {
      return { error: 'Only admins can change a settled debt status' }
    }

    const { data, error } = await supabase
      .from('debts')
      .update({ status })
      .eq('id', debtId)
      .select()
      .single()

    if (error) return { error: error.message }

    revalidatePath('/dashboard/admin/debts')
    revalidatePath('/dashboard/collector/debts')
    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function assignDebtAction(debtId: string, collectorId: string) {
  try {
    const { supabase, user, profile } = await requireAuth()

    if (!['admin', 'manager'].includes(profile.role)) {
      return { error: 'Insufficient permissions' }
    }

    // Verify collector belongs to same company
    const { data: collector } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', collectorId)
      .eq('company_id', profile.company_id)
      .single()

    if (!collector) return { error: 'Collector not found in your company' }

    const { data, error } = await supabase
      .from('debts')
      .update({ assigned_to: collectorId })
      .eq('id', debtId)
      .eq('company_id', profile.company_id)
      .select()
      .single()

    if (error) return { error: error.message }

    revalidatePath('/dashboard/admin/debts')
    revalidatePath('/dashboard/manager/debts')
    return { data }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function recordPaymentAction(input: {
  debt_id:          string
  amount:           number
  payment_date?:    string
  payment_method?:  string
  reference_number?: string
  notes?:           string
}) {
  try {
    const { supabase, user, profile } = await requireAuth()

    if (!input.debt_id) return { error: 'debt_id is required' }
    if (!input.amount || input.amount <= 0) return { error: 'Amount must be positive' }

    // Fetch debt â€” RLS ensures it belongs to the user's company
    const { data: debt } = await supabase
      .from('debts')
      .select('id, current_balance, customer_id, currency, company_id, status')
      .eq('id', input.debt_id)
      .single()

    if (!debt) return { error: 'Debt not found' }
    if (debt.status === 'settled') return { error: 'Debt is already settled' }
    if (input.amount > Number(debt.current_balance)) {
      return { error: `Amount exceeds balance (${debt.current_balance} ${debt.currency})` }
    }

    const newBalance    = Math.max(0, Number(debt.current_balance) - input.amount)
    const isFullPayment = newBalance === 0

    // Insert payment record
    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .insert({
        company_id:       profile.company_id,
        debt_id:          input.debt_id,
        customer_id:      debt.customer_id,
        recorded_by:      user.id,
        amount:           input.amount,
        currency:         debt.currency,
        payment_method:   input.payment_method ?? 'bank_transfer',
        payment_date:     input.payment_date ?? new Date().toISOString().split('T')[0],
        reference_number: input.reference_number ?? null,
        notes:            input.notes ?? null,
        status:           'completed',
      })
      .select()
      .single()

    if (payErr) return { error: payErr.message }

    await recordAttribution({
      company_id: profile.company_id,
      event_type: isFullPayment ? 'settlement' : 'payment',
      payment_id: payment.id,
      customer_id: debt.customer_id,
      debt_id: input.debt_id,
      amount: input.amount,
      primary_channel: 'collector',
      primary_actor: 'collector',
      ai_assisted: false,
      collector_id: user.id,
    })

    // Update debt balance and status
    const { error: debtErr } = await supabase
      .from('debts')
      .update({
        current_balance:   newBalance,
        last_payment_date: input.payment_date ?? new Date().toISOString().split('T')[0],
        status:            isFullPayment ? 'settled' : debt.status,
      })
      .eq('id', input.debt_id)

    if (debtErr) return { error: debtErr.message }

    revalidatePath('/dashboard/admin/debts')
    revalidatePath('/dashboard/collector/debts')
    return { data: payment }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ============================================================
// Read with filters (for server components)
// ============================================================

export async function getDebtsWithFilters(filters: {
  status?:      DebtStatus
  priority?:    DebtPriority
  assigned_to?: string
  limit?:       number
  offset?:      number
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized', data: [] }

  let query = supabase
    .from('debts')
    .select(`
      *,
      customer:customers(id, full_name, phone, whatsapp),
      assigned_collector:profiles!debts_assigned_to_fkey(id, full_name, email),
      ai_scores(score, risk_classification, collection_probability, created_at)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 50)

  if (filters.status)      query = (query as any).eq('status', filters.status)
  if (filters.priority)    query = (query as any).eq('priority', filters.priority)
  if (filters.assigned_to) query = (query as any).eq('assigned_to', filters.assigned_to)
  if (filters.offset)      query = (query as any).range(filters.offset, (filters.offset ?? 0) + (filters.limit ?? 50) - 1)

  const { data, error, count } = await query
  if (error) return { error: error.message, data: [] }
  return { data: data ?? [], count }
}


