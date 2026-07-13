/**
 * AI System Auditor
 *
 * Inspects every module of AI Debt OS and produces a health report.
 * Does NOT modify any data unless called with safeFix=true,
 * in which case only non-destructive fixes are applied:
 *   - creating missing system_config rows
 *   - enabling module flags
 *   - adding missing timeline entries
 *   - fixing orphaned orchestrator references
 *
 * The auditor checks:
 *   1. Database tables — expected vs existing
 *   2. API routes — reachability
 *   3. Dashboard pages — existence
 *   4. Automation pipeline — step completions in recent runs
 *   5. Module connections — which modules write data, which only display
 *   6. Integration credentials — which are configured
 *   7. Missing links — modules that exist but aren't wired up
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('auditor')

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type AuditStatus =
  | 'working'
  | 'partial'
  | 'broken'
  | 'not_connected'
  | 'needs_credentials'
  | 'empty'

export interface AuditItem {
  name:        string
  category:    string
  status:      AuditStatus
  detail:      string
  row_count?:  number
  last_active?: string
  fix?:        string   // what safe_fix=true would do
}

export interface AuditReport {
  generated_at:  string
  company_id:    string
  health_score:  number   // 0-100
  total_checks:  number
  working:       number
  partial:       number
  broken:        number
  not_connected: number
  needs_credentials: number
  empty:         number
  items:         AuditItem[]
  // Quick summary buckets
  summary: {
    tables:       AuditItem[]
    api_routes:   AuditItem[]
    pages:        AuditItem[]
    pipeline:     AuditItem[]
    modules:      AuditItem[]
    integrations: AuditItem[]
  }
  safe_fixes_applied?: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Expected tables (minimum required to function)
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_TABLES = [
  'companies','profiles','customers','debts','payments','messages',
  'ai_scores','ai_actions','ai_memory','timeline_events',
  'system_alerts','system_config','promises','approvals','campaigns',
  'portfolios','job_queue','integration_settings',
  'orchestrator_runs','legal_escalations',
  // Added during a full-system audit: the campaign engine overhaul added
  // campaign_send_queue/campaign_recipients/disputes as real, load-bearing
  // tables, but the health page had zero visibility into any of them —
  // an operator watching صحة النظام had no way to notice a stuck send
  // queue or an unreviewed dispute.
  'campaign_send_queue','campaign_recipients','disputes',
]

// ─────────────────────────────────────────────────────────────────────────────
// Expected API routes
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_ROUTES = [
  { path: '/api/debts/import',        method: 'POST', name: 'CSV/Excel import' },
  { path: '/api/ai/score',            method: 'POST', name: 'AI Scoring' },
  { path: '/api/ai/recommend',        method: 'POST', name: 'AI Actions' },
  { path: '/api/pipeline',            method: 'POST', name: 'Pipeline trigger' },
  { path: '/api/orchestrator',        method: 'POST', name: 'Orchestrator' },
  { path: '/api/auditor',             method: 'GET',  name: 'Auditor' },
  { path: '/api/jobs/worker',         method: 'GET',  name: 'Job worker (cron)' },
  { path: '/api/whatsapp/waha-webhook', method: 'POST', name: 'WhatsApp webhook' },
  { path: '/api/whatsapp/send',       method: 'POST', name: 'WhatsApp send' },
  { path: '/api/sync',                method: 'POST', name: 'Collection sync' },
  { path: '/api/modules/timeline',    method: 'GET',  name: 'Timeline module' },
  { path: '/api/modules/alerts',      method: 'GET',  name: 'Alerts module' },
  { path: '/api/modules/campaigns',   method: 'GET',  name: 'Campaigns module' },
  { path: '/api/modules/promises',    method: 'GET',  name: 'Promises module' },
  { path: '/api/modules/approvals',   method: 'GET',  name: 'Approvals module' },
  { path: '/api/modules/memory',      method: 'GET',  name: 'AI Memory module' },
  { path: '/api/health',              method: 'GET',  name: 'Health check' },
  { path: '/api/cron/legal-escalation-check', method: 'GET', name: 'Legal escalation cron' },
  { path: '/api/cron/send-campaign-queue',    method: 'GET', name: 'Campaign queue cron' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Expected dashboard pages
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_PAGES = [
  { path: '/dashboard/admin',               name: 'Main Dashboard' },
  { path: '/dashboard/admin/debts',         name: 'Debts' },
  { path: '/dashboard/admin/customers',     name: 'Customers' },
  { path: '/dashboard/admin/ai-actions',    name: 'AI Actions' },
  { path: '/dashboard/admin/messages',      name: 'Messages' },
  { path: '/dashboard/admin/analytics',     name: 'Analytics' },
  { path: '/dashboard/admin/campaigns',     name: 'Campaigns' },
  { path: '/dashboard/admin/promises',      name: 'Promises' },
  { path: '/dashboard/admin/approvals',     name: 'Approvals' },
  { path: '/dashboard/admin/alerts',        name: 'Alerts' },
  { path: '/dashboard/admin/memory',        name: 'AI Memory' },
  { path: '/dashboard/admin/automation',    name: 'Automation' },
  { path: '/dashboard/admin/integrations',  name: 'Integrations' },
  { path: '/dashboard/admin/portfolios',    name: 'Portfolios' },
  { path: '/dashboard/admin/legal-escalations', name: 'Legal Escalations' },
  { path: '/dashboard/admin/strategy-insights', name: 'Strategy Insights' },
  { path: '/dashboard/admin/payments',      name: 'Payments' },
  { path: '/dashboard/admin/health',        name: 'System Health' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Module connection map
// (module_name → which DB table it writes to AND reads from)
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_MAP = [
  { name: 'AI Scoring',      writes: 'ai_scores',       reads: 'ai_scores',       pipeline_step: 'score' },
  { name: 'AI Actions',      writes: 'ai_actions',      reads: 'ai_actions',      pipeline_step: 'action' },
  { name: 'AI Memory',       writes: 'ai_memory',       reads: 'ai_memory',       pipeline_step: 'memory' },
  { name: 'Timeline',        writes: 'timeline_events', reads: 'timeline_events', pipeline_step: 'timeline' },
  { name: 'Alerts',          writes: 'system_alerts',   reads: 'system_alerts',   pipeline_step: 'alerts' },
  { name: 'Promises',        writes: 'promises',        reads: 'promises',        pipeline_step: 'promises' },
  { name: 'Approvals',       writes: 'approvals',       reads: 'approvals',       pipeline_step: 'approvals' },
  { name: 'Campaigns',       writes: 'campaigns',       reads: 'campaigns',       pipeline_step: 'campaigns' },
  { name: 'WhatsApp Queue',  writes: 'job_queue',       reads: 'messages',        pipeline_step: 'whatsapp' },
  { name: 'Orchestrator Log',writes: 'orchestrator_runs',reads: 'orchestrator_runs',pipeline_step: 'batch' },
  { name: 'Campaign Send Queue', writes: 'campaign_send_queue', reads: 'campaign_send_queue', pipeline_step: 'campaign_send' },
  { name: 'Disputes',        writes: 'disputes',        reads: 'disputes',        pipeline_step: 'disputes' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function tableCount(sb: ReturnType<typeof createServiceClient>, table: string, companyId: string): Promise<number | null> {
  try {
    const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId)
    return count ?? 0
  } catch {
    return null
  }
}

async function tableExists(sb: ReturnType<typeof createServiceClient>, table: string): Promise<boolean> {
  try {
    await sb.from(table).select('id').limit(0)
    return true
  } catch {
    return false
  }
}

async function lastRowDate(sb: ReturnType<typeof createServiceClient>, table: string, companyId: string): Promise<string | null> {
  try {
    const { data } = await sb.from(table).select('created_at').eq('company_id', companyId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    return data ? (data as Record<string,string>).created_at : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main audit function
// ─────────────────────────────────────────────────────────────────────────────

export async function runAudit(companyId: string, safeFix = false): Promise<AuditReport> {
  const sb = createServiceClient()
  const items: AuditItem[] = []
  const safeFixes: string[] = []

  // ── 1. Tables ─────────────────────────────────────────────────────────────
  for (const table of EXPECTED_TABLES) {
    const exists = await tableExists(sb, table)
    if (!exists) {
      items.push({
        name: table, category: 'table',
        status: 'broken',
        detail: `Table "${table}" does not exist in the database`,
        fix: `Run migration SQL to create table "${table}"`,
      })
      continue
    }

    const count   = await tableCount(sb, table, companyId)
    const lastRow = count && count > 0 ? await lastRowDate(sb, table, companyId) : null

    let status: AuditStatus = 'working'
    let detail  = `${count ?? 0} rows for this company`

    // Special checks per table
    if (table === 'system_config') {
      const { data: cfg } = await sb.from('system_config').select('automation_mode,modules').eq('company_id', companyId).maybeSingle()
      if (!cfg) {
        status = 'broken'
        detail = 'No system_config row for this company'
        if (safeFix) {
          // Real gap found during a full-system audit: this self-auditing
          // tool's OWN fix was unchecked — a genuinely failed insert (not
          // just "row already exists", which never throws here anyway)
          // would still report status:'working'/"Created..." despite
          // nothing being created, exactly the false-positive this tool
          // exists to prevent elsewhere.
          const { error: cfgInsertErr } = await sb.from('system_config').insert({ company_id: companyId, automation_mode: 'off' })
          if (!cfgInsertErr) {
            safeFixes.push('Created missing system_config row')
            status = 'working'
            detail = 'Created default system_config row (mode=off)'
          }
        }
      } else {
        const d = cfg as Record<string,unknown>
        detail = `mode=${d.automation_mode}, modules configured`
      }
    } else if (table === 'ai_scores' && (count ?? 0) === 0) {
      status = 'empty'
      detail = 'No AI scores yet — import some debts and run the pipeline'
    } else if (table === 'timeline_events' && (count ?? 0) === 0) {
      status = 'empty'
      detail = 'No timeline events yet — pipeline has not run for this company'
    } else if (table === 'orchestrator_runs' && (count ?? 0) === 0) {
      status = 'empty'
      detail = 'No orchestrator runs yet — no events have been processed'
    } else if (count === null) {
      status = 'broken'
      detail = 'Could not query table — RLS may be blocking access'
    }

    items.push({
      name:         table,
      category:     'table',
      status,
      detail,
      row_count:    count ?? undefined,
      last_active:  lastRow ?? undefined,
    })
  }

  // ── 2. API routes (check file existence, not live HTTP) ───────────────────
  const fs = await import('fs')
  const path = await import('path')
  const apiBase = path.join(process.cwd(), 'src', 'app', 'api')

  for (const route of EXPECTED_ROUTES) {
    // Convert /api/foo/bar → src/app/api/foo/bar/route.ts
    const rel     = route.path.replace(/^\/api/, '')
    const fspath  = path.join(apiBase, rel, 'route.ts')
    const exists  = fs.existsSync(fspath)

    items.push({
      name:     route.name,
      category: 'api_route',
      status:   exists ? 'working' : 'broken',
      detail:   exists
        ? `${route.method} ${route.path} — route file found`
        : `${route.method} ${route.path} — route.ts file missing`,
      fix: exists ? undefined : `Create src/app${route.path}/route.ts`,
    })
  }

  // ── 3. Dashboard pages ────────────────────────────────────────────────────
  const pagesBase = path.join(process.cwd(), 'src', 'app', 'dashboard')

  for (const page of EXPECTED_PAGES) {
    const rel    = page.path.replace(/^\/dashboard/, '')
    const fpath  = path.join(pagesBase, rel, 'page.tsx')
    const exists = fs.existsSync(fpath)

    items.push({
      name:     page.name,
      category: 'page',
      status:   exists ? 'working' : 'broken',
      detail:   exists
        ? `${page.path}/page.tsx found`
        : `${page.path}/page.tsx missing`,
      fix: exists ? undefined : `Create ${page.path}/page.tsx`,
    })
  }

  // ── 4. Pipeline step analysis (from recent orchestrator runs) ─────────────
  const { data: recentRuns } = await sb.from('orchestrator_runs')
    .select('steps_completed,steps_skipped,steps_failed,success,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(50)

  const runs = (recentRuns ?? []) as Array<Record<string, unknown>>

  if (runs.length === 0) {
    items.push({
      name:     'Pipeline execution',
      category: 'pipeline',
      status:   'not_connected',
      detail:   'No orchestrator runs recorded. Import a CSV or trigger the pipeline manually.',
      fix:      'Import a CSV/XLSX file or call POST /api/pipeline?batch=true',
    })
  } else {
    const totalRuns   = runs.length
    const failedRuns  = runs.filter(r => !r.success).length
    const successRate = Math.round(((totalRuns - failedRuns) / totalRuns) * 100)

    items.push({
      name:     'Pipeline execution',
      category: 'pipeline',
      status:   successRate >= 80 ? 'working' : successRate >= 40 ? 'partial' : 'broken',
      detail:   `${totalRuns} runs, ${successRate}% success rate. Last: ${String(runs[0]?.created_at ?? '').slice(0,19)}`,
    })

    // Per-module step analysis from runs
    for (const mod of MODULE_MAP) {
      const withStep    = runs.filter(r => {
        const s = r.steps_completed as string[] ?? []
        return s.some(x => x.startsWith(mod.pipeline_step))
      }).length
      const withSkipped = runs.filter(r => {
        const s = r.steps_skipped as string[] ?? []
        return s.some(x => x.startsWith(mod.pipeline_step))
      }).length
      const withFailed  = runs.filter(r => {
        const s = r.steps_failed as string[] ?? []
        return s.some(x => x.startsWith(mod.pipeline_step))
      }).length

      let status: AuditStatus
      let detail: string

      if (withStep > 0 && withFailed === 0) {
        status = 'working'
        detail = `Completed in ${withStep}/${totalRuns} runs`
      } else if (withStep > 0 && withFailed > 0) {
        status = 'partial'
        detail = `Completed ${withStep}, failed ${withFailed} times out of ${totalRuns} runs`
      } else if (withSkipped > 0) {
        status = 'partial'
        detail = `Always skipped (${withSkipped}/${totalRuns} runs) — check automation_mode`
      } else if (withFailed > 0) {
        status = 'broken'
        detail = `Failed in ${withFailed}/${totalRuns} runs — check logs`
      } else {
        status = 'not_connected'
        detail = `Step "${mod.pipeline_step}" never appeared in run logs`
      }

      items.push({
        name:     mod.name,
        category: 'pipeline',
        status,
        detail,
        row_count: await tableCount(sb, mod.writes, companyId) ?? undefined,
      })
    }
  }

  // ── 5. Module data connections ────────────────────────────────────────────
  const moduleChecks = [
    { name: 'AI Score → Debt page',          table: 'ai_scores',      page: 'debts' },
    { name: 'Timeline → Customer page',       table: 'timeline_events',page: 'customers' },
    { name: 'Alerts → Alerts page',           table: 'system_alerts',  page: 'alerts' },
    { name: 'AI Actions → AI Actions page',   table: 'ai_actions',     page: 'ai-actions' },
    { name: 'Promises → Promises page',       table: 'promises',       page: 'promises' },
    { name: 'Approvals → Approvals page',     table: 'approvals',      page: 'approvals' },
    { name: 'Campaigns → Campaigns page',     table: 'campaigns',      page: 'campaigns' },
    { name: 'AI Memory → Memory page',        table: 'ai_memory',      page: 'memory' },
    { name: 'Orchestrator runs → Health page',table: 'orchestrator_runs',page: 'health' },
  ]

  for (const check of moduleChecks) {
    const count     = await tableCount(sb, check.table, companyId)
    const pageFile  = path.join(pagesBase, 'admin', check.page, 'page.tsx')
    const pageExists = fs.existsSync(pageFile)

    let status: AuditStatus = 'working'
    let detail = ''

    if (!pageExists) {
      status = 'broken'
      detail = `Table "${check.table}" has data but page "${check.page}" is missing`
    } else if (count === null) {
      status = 'broken'
      detail = `Cannot read "${check.table}" — RLS issue`
    } else if (count === 0) {
      status = 'empty'
      detail = `Table "${check.table}" is empty — pipeline has not written data here yet`
    } else {
      detail = `${count} rows in "${check.table}" — page exists`
    }

    items.push({
      name:     check.name,
      category: 'module',
      status,
      detail,
      row_count: count ?? undefined,
    })
  }

  // ── 6. Integrations ───────────────────────────────────────────────────────
  // Root-cause fix (2026-07-13): the WhatsApp entries here checked
  // WHATSAPP_PHONE_NUMBER_ID/ACCESS_TOKEN — the official WhatsApp Business
  // Cloud API's variables. This app's actual send channel is the WAHA
  // gateway (src/lib/whatsapp.ts); those Cloud API vars are unset in every
  // real environment, so this always reported "needs_credentials" regardless
  // of WAHA's real health — the same bug already fixed in src/lib/env.ts's
  // isWhatsAppConfigured and src/lib/monitoring.ts's checkWhatsApp. Also
  // fixed the fix-suggestion text below: this app deploys to a Hostinger
  // VPS via deploy.ps1, never to Vercel.
  const integrationChecks = [
    { key: 'OPENROUTER_API_KEY',          name: 'OpenRouter (All AI Models)' },
    { key: 'WAHA_API_URL',               name: 'WhatsApp (WAHA Gateway URL)' },
    { key: 'WAHA_API_KEY',               name: 'WhatsApp (WAHA Gateway Key)' },
    { key: 'NEXT_PUBLIC_SUPABASE_URL',   name: 'Supabase (Database)' },
    { key: 'SUPABASE_SERVICE_ROLE_KEY',  name: 'Supabase (Service Role)' },
  ]

  for (const check of integrationChecks) {
    const configured = !!(process.env[check.key])
    items.push({
      name:     check.name,
      category: 'integration',
      status:   configured ? 'working' : 'needs_credentials',
      detail:   configured
        ? `${check.key} is configured`
        : `${check.key} environment variable is missing`,
      fix: configured ? undefined : `Set ${check.key} in .env.local on the VPS`,
    })
  }

  // Check saved integration_settings
  try {
    const { data: integSettings } = await sb.from('integration_settings')
      .select('integration_name,enabled,config')
      .eq('company_id', companyId)

    const settings = (integSettings ?? []) as Array<Record<string, unknown>>
    const collectionApi = settings.find(s => s.integration_name === 'collection_api')

    items.push({
      name:     'Collection System API',
      category: 'integration',
      status:   collectionApi?.enabled ? 'working' :
                collectionApi          ? 'partial' : 'not_connected',
      detail:   collectionApi?.enabled
        ? 'Configured and enabled'
        : collectionApi
          ? 'Configured but disabled'
          : 'Not configured — go to Integrations to add collection system URL and token',
      fix: collectionApi ? undefined : 'Add Collection API credentials in /dashboard/admin/integrations',
    })
  } catch { /* non-critical */ }

  // ── 7. Automation mode check ──────────────────────────────────────────────
  try {
    const { data: cfg } = await sb.from('system_config')
      .select('automation_mode,emergency_stop_all,emergency_stop_ai')
      .eq('company_id', companyId)
      .maybeSingle()

    const d = cfg as Record<string, unknown> | null
    const mode = String(d?.automation_mode ?? 'off')
    const emergency = !!(d?.emergency_stop_all) || !!(d?.emergency_stop_ai)

    items.push({
      name:     'Automation Mode',
      category: 'pipeline',
      status:   emergency ? 'broken' : mode === 'live' ? 'working' : mode === 'test' ? 'partial' : 'partial',
      detail:   emergency
        ? 'EMERGENCY STOP IS ACTIVE — no AI actions will run'
        : mode === 'off'
          ? 'Automation is OFF — AI Actions will not be generated. Switch to "test" or "live" mode.'
          : mode === 'test'
            ? 'TEST mode — AI Actions created but WhatsApp not sent'
            : 'LIVE mode — fully operational',
      fix: mode === 'off' ? 'Change automation_mode to "test" or "live" in Automation settings' : undefined,
    })
  } catch { /* non-critical */ }

  // ── Calculate health score ────────────────────────────────────────────────
  const weights: Record<AuditStatus, number> = {
    working:           1.0,
    partial:           0.5,
    broken:            0.0,
    not_connected:     0.2,
    needs_credentials: 0.3,
    empty:             0.7,
  }

  const totalScore   = items.reduce((s, i) => s + (weights[i.status] ?? 0), 0)
  const healthScore  = Math.round((totalScore / items.length) * 100)

  const counts = {
    working:           items.filter(i => i.status === 'working').length,
    partial:           items.filter(i => i.status === 'partial').length,
    broken:            items.filter(i => i.status === 'broken').length,
    not_connected:     items.filter(i => i.status === 'not_connected').length,
    needs_credentials: items.filter(i => i.status === 'needs_credentials').length,
    empty:             items.filter(i => i.status === 'empty').length,
  }

  const report: AuditReport = {
    generated_at:      new Date().toISOString(),
    company_id:        companyId,
    health_score:      healthScore,
    total_checks:      items.length,
    ...counts,
    items,
    summary: {
      tables:       items.filter(i => i.category === 'table'),
      api_routes:   items.filter(i => i.category === 'api_route'),
      pages:        items.filter(i => i.category === 'page'),
      pipeline:     items.filter(i => i.category === 'pipeline'),
      modules:      items.filter(i => i.category === 'module'),
      integrations: items.filter(i => i.category === 'integration'),
    },
    safe_fixes_applied: safeFix && safeFixes.length ? safeFixes : undefined,
  }

  log.info('Audit complete', {
    company_id: companyId, health_score: healthScore, total: items.length, ...counts,
  })

  return report
}
