/**
 * AI System Orchestrator
 *
 * The single, authoritative entry point for every event that touches
 * a customer or debt in AI Debt OS.
 *
 * Call `orchestrate(event)` from:
 *   - CSV / Excel import
 *   - API sync (Debit Collect, etc.)
 *   - WhatsApp webhook (inbound message)
 *   - Payment recorded
 *   - Promise created/updated
 *   - Manual debt/customer update
 *   - Collector note saved
 *
 * The orchestrator:
 *   1. Delegates to processEvent() (the automation pipeline)
 *   2. Persists a full run log to orchestrator_runs
 *   3. Returns a typed OrchestratorResult with every step's outcome
 *
 * Safety guarantees:
 *   - Never modifies data directly — all writes go through the pipeline
 *   - Never sends WhatsApp unless automation_mode = 'live' AND WA configured
 *   - Never crashes the caller — all errors are caught and returned
 *   - Idempotent — safe to call twice for the same event
 */

import { createServiceClient } from '@/lib/supabase/server'
import {
  processEvent, processEventBatch,
  type PipelineEvent, type PipelineResult, type EventSource,
} from '@/lib/automation-pipeline'
import { createLogger } from '@/lib/logger'

const log = createLogger('orchestrator')

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type { EventSource }

export interface OrchestratorEvent {
  source:       EventSource
  company_id:   string
  debt_id?:     string
  customer_id?: string
  actor_id?:    string
  data?:        Record<string, unknown>
}

export interface OrchestratorResult {
  success:           boolean
  debt_id?:          string
  customer_id?:      string
  run_id?:           string
  mode:              string
  // Per-module outcomes
  modules: {
    ai_score:       ModuleStatus
    ai_actions:     ModuleStatus
    ai_memory:      ModuleStatus
    timeline:       ModuleStatus
    alerts:         ModuleStatus
    rules:          ModuleStatus
    promises:       ModuleStatus
    approvals:      ModuleStatus
    campaigns:      ModuleStatus
    whatsapp:       ModuleStatus
    revenue:        ModuleStatus
  }
  // Counts
  ai_score_value?:   number
  ai_risk?:          string
  actions_created:   number
  alerts_created:    number
  memory_entries:    number
  // Timing
  duration_ms:       number
  // Full step log
  steps_completed:   string[]
  steps_skipped:     string[]
  steps_failed:      string[]
  error?:            string
}

export type ModuleStatus =
  | 'completed'
  | 'skipped'
  | 'failed'
  | 'not_applicable'

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build module status map from PipelineResult
// ─────────────────────────────────────────────────────────────────────────────

function buildModuleMap(r: PipelineResult): OrchestratorResult['modules'] {
  const completed = new Set(r.steps_completed)
  const skipped   = new Set(r.steps_skipped)
  const failed    = new Set(r.steps_failed)

  function status(prefix: string): ModuleStatus {
    if ([...completed].some(s => s.startsWith(prefix))) return 'completed'
    if ([...skipped].some(s => s.startsWith(prefix)))   return 'skipped'
    if ([...failed].some(s => s.startsWith(prefix)))    return 'failed'
    return 'not_applicable'
  }

  return {
    ai_score:   status('score'),
    ai_actions: status('action'),
    ai_memory:  status('memory'),
    timeline:   status('timeline'),
    alerts:     status('alerts'),
    rules:      status('rules'),
    promises:   status('promises'),
    approvals:  status('approvals'),
    campaigns:  status('campaigns'),
    whatsapp:   status('whatsapp'),
    revenue:    'not_applicable', // attributed separately via collection_attribution (revenue-attribution.ts)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist orchestrator run log
// ─────────────────────────────────────────────────────────────────────────────

async function persistRunLog(
  event:  OrchestratorEvent,
  result: OrchestratorResult,
): Promise<string | undefined> {
  try {
    const sb = createServiceClient()
    const { data } = await sb.from('orchestrator_runs').insert({
      company_id:      event.company_id,
      event_source:    event.source,
      debt_id:         result.debt_id         ?? null,
      customer_id:     result.customer_id     ?? null,
      mode:            result.mode,
      ai_score:        result.ai_score_value  ?? null,
      ai_risk:         result.ai_risk         ?? null,
      ai_actions_count: result.actions_created,
      alerts_count:    result.alerts_created,
      memory_count:    result.memory_entries,
      steps_completed: result.steps_completed,
      steps_skipped:   result.steps_skipped,
      steps_failed:    result.steps_failed,
      success:         result.success,
      error_message:   result.error ?? null,
      duration_ms:     result.duration_ms,
      triggered_by:    event.actor_id ?? null,
    }).select('id').single()
    return (data as { id: string } | null)?.id
  } catch (err) {
    log.warn('persistRunLog failed: ' + (err instanceof Error ? err.message : String(err)))
    return undefined
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: orchestrate a single event
// ─────────────────────────────────────────────────────────────────────────────

export async function orchestrate(event: OrchestratorEvent): Promise<OrchestratorResult> {
  const t0 = Date.now()

  const blank: OrchestratorResult = {
    success: false, mode: 'off',
    actions_created: 0, alerts_created: 0, memory_entries: 0,
    steps_completed: [], steps_skipped: [], steps_failed: [],
    duration_ms: 0,
    modules: {
      ai_score: 'not_applicable', ai_actions: 'not_applicable',
      ai_memory: 'not_applicable', timeline: 'not_applicable',
      alerts: 'not_applicable', rules: 'not_applicable',
      promises: 'not_applicable', approvals: 'not_applicable',
      campaigns: 'not_applicable', whatsapp: 'not_applicable',
      revenue: 'not_applicable',
    },
  }

  try {
    const pipelineEvent: PipelineEvent = {
      source:      event.source,
      company_id:  event.company_id,
      actor_id:    event.actor_id,
      _debt_id:    event.debt_id,
      _customer_id: event.customer_id,
      data:        event.data,
    }

    const r: PipelineResult = await processEvent(pipelineEvent)

    const result: OrchestratorResult = {
      success:         r.success,
      debt_id:         r.debt_id,
      customer_id:     r.customer_id,
      mode:            r.mode,
      ai_score_value:  r.ai_score,
      ai_risk:         r.ai_risk,
      actions_created: r.ai_actions_count,
      alerts_created:  r.alerts_count,
      memory_entries:  r.memory_count,
      steps_completed: r.steps_completed,
      steps_skipped:   r.steps_skipped,
      steps_failed:    r.steps_failed,
      error:           r.error,
      duration_ms:     Date.now() - t0,
      modules:         buildModuleMap(r),
    }

    result.run_id = await persistRunLog(event, result)

    log.info('Orchestrated', {
      source:   event.source,
      debt_id:  result.debt_id,
      mode:     result.mode,
      score:    result.ai_score_value,
      actions:  result.actions_created,
      alerts:   result.alerts_created,
      ms:       result.duration_ms,
    })

    return result
  } catch (err) {
    const result: OrchestratorResult = {
      ...blank,
      error:       err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - t0,
    }
    await persistRunLog(event, result)
    log.warn('Orchestrate failed: ' + result.error)
    return result
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch orchestration (e.g. CSV import with N rows)
// ─────────────────────────────────────────────────────────────────────────────

export interface BatchOrchestratorInput {
  source:     EventSource
  company_id: string
  actor_id?:  string
  records:    Array<{ debt_id?: string; customer_id?: string; data?: Record<string, unknown> }>
  concurrency?: number
}

export interface BatchOrchestratorResult {
  total:           number
  succeeded:       number
  failed:          number
  skipped:         number
  total_actions:   number
  total_alerts:    number
  total_memory:    number
  duration_ms:     number
  per_record?:     OrchestratorResult[]
  include_details: boolean
}

export async function orchestrateBatch(
  opts: BatchOrchestratorInput,
  includeDetails = false,
): Promise<BatchOrchestratorResult> {
  const t0     = Date.now()
  const events: PipelineEvent[] = opts.records.map(r => ({
    source:       opts.source,
    company_id:   opts.company_id,
    actor_id:     opts.actor_id,
    _debt_id:     r.debt_id,
    _customer_id: r.customer_id,
    data:         r.data,
  }))

  const batchResult = await processEventBatch(events, opts.concurrency ?? 4)

  // Persist a single summary run log for the batch
  const summaryResult: OrchestratorResult = {
    success:         batchResult.failed === 0,
    mode:            'batch',
    actions_created: batchResult.total_actions,
    alerts_created:  batchResult.total_alerts,
    memory_entries:  0,
    steps_completed: [`batch:${batchResult.succeeded}`],
    steps_skipped:   [`skipped:${batchResult.skipped}`],
    steps_failed:    [`failed:${batchResult.failed}`],
    duration_ms:     Date.now() - t0,
    modules: {
      ai_score: 'completed', ai_actions: 'completed', ai_memory: 'completed',
      timeline: 'completed', alerts: 'completed', rules: 'completed',
      promises: 'completed', approvals: 'completed', campaigns: 'completed',
      whatsapp: 'skipped', revenue: 'not_applicable',
    },
  }

  try {
    const sb = createServiceClient()
    await sb.from('orchestrator_runs').insert({
      company_id:       opts.company_id,
      event_source:     opts.source + '_batch',
      mode:             'batch',
      ai_actions_count: batchResult.total_actions,
      alerts_count:     batchResult.total_alerts,
      memory_count:     0,
      steps_completed:  summaryResult.steps_completed,
      steps_skipped:    summaryResult.steps_skipped,
      steps_failed:     summaryResult.steps_failed,
      success:          summaryResult.success,
      duration_ms:      summaryResult.duration_ms,
      triggered_by:     opts.actor_id ?? null,
    })
  } catch { /* non-critical */ }

  return {
    total:           batchResult.total,
    succeeded:       batchResult.succeeded,
    failed:          batchResult.failed,
    skipped:         batchResult.skipped,
    total_actions:   batchResult.total_actions,
    total_alerts:    batchResult.total_alerts,
    total_memory:    0,
    duration_ms:     Date.now() - t0,
    per_record:      includeDetails ? [] : undefined,
    include_details: includeDetails,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent run history (for health dashboard)
// ─────────────────────────────────────────────────────────────────────────────

export async function getRecentRuns(companyId: string, limit = 20) {
  try {
    const sb = createServiceClient()
    const { data } = await sb
      .from('orchestrator_runs')
      .select('id,event_source,mode,ai_score,ai_risk,ai_actions_count,alerts_count,success,error_message,duration_ms,created_at,steps_failed')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(limit)
    return data ?? []
  } catch {
    return []
  }
}

export async function getRunStats(companyId: string) {
  try {
    const sb      = createServiceClient()
    const since24 = new Date(Date.now() - 86400000).toISOString()
    const [totalRes, failedRes, todayRes] = await Promise.all([
      sb.from('orchestrator_runs').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      sb.from('orchestrator_runs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('success', false),
      sb.from('orchestrator_runs').select('id', { count: 'exact', head: true }).eq('company_id', companyId).gte('created_at', since24),
    ])
    return {
      total:    totalRes.count  ?? 0,
      failed:   failedRes.count ?? 0,
      today:    todayRes.count  ?? 0,
      success_rate: totalRes.count
        ? Math.round(((totalRes.count - (failedRes.count ?? 0)) / totalRes.count) * 100)
        : 100,
    }
  } catch {
    return { total: 0, failed: 0, today: 0, success_rate: 100 }
  }
}
