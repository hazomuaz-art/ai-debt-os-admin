/**
 * Tenant Management
 * Handles company activation, suspension, and lifecycle event logging.
 * All writes use the service client so they bypass per-user RLS.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('tenant-management')

export type TenantEventType =
  | 'created' | 'activated' | 'suspended' | 'cancelled'
  | 'plan_changed' | 'limit_changed' | 'trial_started' | 'trial_ended'

export interface TenantStatus {
  company_id:   string
  is_active:    boolean
  plan:         string
  sub_status:   string | null
  trial_ends:   string | null
  period_end:   string | null
}

/** Fetch current status for a company */
export async function getTenantStatus(companyId: string): Promise<TenantStatus | null> {
  try {
    const sb = createServiceClient()
    const { data: company } = await sb
      .from('companies')
      .select('id, is_active, plan')
      .eq('id', companyId)
      .single()
    if (!company) return null

    const { data: sub } = await sb
      .from('company_subscriptions')
      .select('status, trial_ends_at, current_period_end')
      .eq('company_id', companyId)
      .maybeSingle()

    return {
      company_id:  companyId,
      is_active:   (company as Record<string,unknown>).is_active as boolean,
      plan:        String((company as Record<string,unknown>).plan ?? 'starter'),
      sub_status:  sub ? String((sub as Record<string,unknown>).status ?? '') : null,
      trial_ends:  sub ? (sub as Record<string,unknown>).trial_ends_at as string | null : null,
      period_end:  sub ? (sub as Record<string,unknown>).current_period_end as string | null : null,
    }
  } catch (err) {
    log.warn('getTenantStatus failed: ' + (err instanceof Error ? err.message : String(err)))
    return null
  }
}

/** Log a tenant lifecycle event */
export async function logTenantEvent(opts: {
  company_id: string
  event_type: TenantEventType
  actor_id?:  string
  old_value?: Record<string, unknown>
  new_value?: Record<string, unknown>
  note?:      string
}): Promise<void> {
  try {
    const sb = createServiceClient()
    const { error } = await sb.from('tenant_events').insert({
      company_id: opts.company_id,
      event_type: opts.event_type,
      actor_id:   opts.actor_id   ?? null,
      old_value:  opts.old_value  ?? {},
      new_value:  opts.new_value  ?? {},
      note:       opts.note       ?? null,
    })
    if (error) log.warn('tenant_events insert failed: ' + error.message)
  } catch (err) {
    log.warn('logTenantEvent failed: ' + (err instanceof Error ? err.message : String(err)))
  }
}

/** Activate a suspended or cancelled company */
export async function activateCompany(companyId: string, actorId?: string): Promise<boolean> {
  try {
    const sb = createServiceClient()
    const before = await getTenantStatus(companyId)

    // Real gap found during a full-system audit: both unchecked — a
    // rejected update would leave the tenant suspended/cancelled while this
    // function still logs "activated" and returns true. Security/billing-
    // relevant state change.
    const { error: companyActivateErr } = await sb.from('companies').update({ is_active: true }).eq('id', companyId)
    if (companyActivateErr) { log.warn('activateCompany: companies update failed: ' + companyActivateErr.message, { company_id: companyId }); return false }
    const { error: subActivateErr } = await sb.from('company_subscriptions')
      .update({ status: 'active' })
      .eq('company_id', companyId)
      .in('status', ['suspended', 'cancelled'])
    if (subActivateErr) { log.warn('activateCompany: company_subscriptions update failed: ' + subActivateErr.message, { company_id: companyId }); return false }

    await logTenantEvent({
      company_id: companyId,
      event_type: 'activated',
      actor_id:   actorId,
      old_value:  { status: before?.sub_status, is_active: before?.is_active },
      new_value:  { status: 'active', is_active: true },
    })

    log.info('Company activated', { company_id: companyId })
    return true
  } catch (err) {
    log.warn('activateCompany failed: ' + (err instanceof Error ? err.message : String(err)))
    return false
  }
}

/** Suspend a company */
export async function suspendCompany(
  companyId: string,
  actorId?:  string,
  reason?:   string,
): Promise<boolean> {
  try {
    const sb = createServiceClient()
    const before = await getTenantStatus(companyId)

    // Real gap found during a full-system audit: both unchecked — a
    // rejected update would leave a supposedly-suspended tenant's access
    // fully active while this function still logs "suspended" and returns
    // true. Security/billing-relevant state change.
    const { error: companySuspendErr } = await sb.from('companies').update({ is_active: false }).eq('id', companyId)
    if (companySuspendErr) { log.warn('suspendCompany: companies update failed: ' + companySuspendErr.message, { company_id: companyId }); return false }
    const { error: subSuspendErr } = await sb.from('company_subscriptions')
      .update({ status: 'suspended' })
      .eq('company_id', companyId)
    if (subSuspendErr) { log.warn('suspendCompany: company_subscriptions update failed: ' + subSuspendErr.message, { company_id: companyId }); return false }

    await logTenantEvent({
      company_id: companyId,
      event_type: 'suspended',
      actor_id:   actorId,
      old_value:  { status: before?.sub_status, is_active: before?.is_active },
      new_value:  { status: 'suspended', is_active: false },
      note:       reason,
    })

    log.info('Company suspended', { company_id: companyId, reason })
    return true
  } catch (err) {
    log.warn('suspendCompany failed: ' + (err instanceof Error ? err.message : String(err)))
    return false
  }
}

/** Get recent tenant events for a company */
export async function getTenantEvents(companyId: string, limit = 20) {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('tenant_events')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit)
    return data ?? []
  } catch {
    return []
  }
}
