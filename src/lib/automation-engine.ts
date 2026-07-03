/**
 * Automation Engine Foundation
 *
 * Controls the OFF / TEST / LIVE automation cycle.
 * In TEST mode: plans actions and logs them, sends nothing.
 * In LIVE mode: executes real actions (WhatsApp, AI calls, etc.).
 * In OFF mode: returns immediately with a skipped result.
 *
 * All execution is delegated to the existing job_queue system.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('automation-engine')

export type AutomationMode = 'off' | 'test' | 'live'

export interface RunOptions {
  company_id:   string
  run_type:     'scheduled' | 'manual' | 'triggered' | 'test'
  triggered_by?: string
}

export interface RunResult {
  run_id:           string | null
  mode:             AutomationMode
  status:           'skipped' | 'running' | 'completed' | 'failed'
  actions_planned:  number
  actions_executed: number
  message:          string
}

/** Get the current automation mode for a company */
export async function getAutomationMode(companyId: string): Promise<AutomationMode> {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('system_config')
      .select('automation_mode, emergency_stop_all')
      .eq('company_id', companyId)
      .maybeSingle()

    if (!data) return 'off'
    const d = data as Record<string, unknown>
    if (d.emergency_stop_all) return 'off'
    const mode = String(d.automation_mode ?? 'off') as AutomationMode
    return ['off', 'test', 'live'].includes(mode) ? mode : 'off'
  } catch {
    return 'off'
  }
}

/** Start an automation run — creates the run record and queues actions */
export async function startAutomationRun(opts: RunOptions): Promise<RunResult> {
  const mode = await getAutomationMode(opts.company_id)

  if (mode === 'off') {
    return {
      run_id: null, mode: 'off', status: 'skipped',
      actions_planned: 0, actions_executed: 0,
      message: 'Automation is OFF. Enable it in Automation settings.',
    }
  }

  try {
    const sb = createServiceClient()

    // Count eligible debts to plan
    const { count: debtCount } = await sb
      .from('debts')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', opts.company_id)
      .not('status', 'in', '("settled","written_off")')

    const planned = debtCount ?? 0

    // Create run record
    // Real gap found during a full-system audit: unchecked — a rejected
    // insert left runId null, silently skipping the live-mode job enqueue
    // below with no error surfaced anywhere.
    const { data: runRow, error: runInsertErr } = await sb
      .from('automation_runs')
      .insert({
        company_id:      opts.company_id,
        run_type:        opts.run_type,
        mode,
        status:          mode === 'test' ? 'completed' : 'running',
        actions_planned: planned,
        actions_executed: mode === 'test' ? 0 : 0,
        triggered_by:    opts.triggered_by ?? null,
        finished_at:     mode === 'test' ? new Date().toISOString() : null,
      })
      .select('id')
      .single()
    if (runInsertErr) log.error('automation_runs insert failed', new Error(runInsertErr.message), { company_id: opts.company_id })

    const runId = (runRow as { id: string } | null)?.id ?? null

    if (mode === 'live' && runId) {
      // Enqueue the actual AI action generation job
      try {
        await sb.rpc('enqueue_job', {
          p_company_id: opts.company_id,
          p_job_type:   'generate_action_plan',
          p_payload:    { run_id: runId, triggered_by: opts.triggered_by },
          p_priority:   5,
        })
      } catch { /* job function may not be deployed yet */ }
    }

    log.info('Automation run started', { run_id: runId, mode, planned })

    return {
      run_id:           runId,
      mode,
      status:           mode === 'test' ? 'completed' : 'running',
      actions_planned:  planned,
      actions_executed: 0,
      message: mode === 'test'
        ? `TEST mode: planned ${planned} actions. No real messages sent.`
        : `LIVE mode: started run for ${planned} eligible debts.`,
    }
  } catch (err) {
    log.warn('startAutomationRun failed: ' + (err instanceof Error ? err.message : String(err)))
    return {
      run_id: null, mode, status: 'failed',
      actions_planned: 0, actions_executed: 0,
      message: 'Automation run failed to start.',
    }
  }
}

/** Get recent automation runs for a company */
export async function getRecentRuns(companyId: string, limit = 10) {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('automation_runs')
      .select('id, run_type, mode, status, actions_planned, actions_executed, cost_usd, started_at, finished_at')
      .eq('company_id', companyId)
      .order('started_at', { ascending: false })
      .limit(limit)
    return data ?? []
  } catch {
    return []
  }
}
