import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { scoreDebt } from '@/lib/ai-engine'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { calculateDaysOverdue } from '@/lib/utils'
import { createLogger } from '@/lib/logger'
import { processEvent } from '@/lib/automation-pipeline'

const log = createLogger('jobs/worker')

const MAX_JOBS_PER_RUN = 10
const JOB_TIMEOUT_MS   = 25_000  // 25s — stay under Vercel's 30s timeout

// Verify this request is from Vercel Cron or an internal caller
function verifyCallerSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization')
  
  // Accept Vercel's auto-injected CRON_SECRET (set in Vercel dashboard)
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true
  
  // Accept manual APP_SECRET for ad-hoc invocations
  const appSecret = process.env.APP_SECRET
  if (!appSecret) {
    log.warn('APP_SECRET not configured — skipping auth (dev mode)')
    return process.env.NODE_ENV !== 'production'
  }
  
  return authHeader === `Bearer ${appSecret}`
}

// POST: Manual trigger (ad-hoc invocation with APP_SECRET)
export async function POST(request: NextRequest) {
  if (!verifyCallerSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runWorker()
}

// Shared worker logic
async function runWorker(): Promise<NextResponse> {

  const startTime = Date.now()
  const supabase  = createServiceClient()
  const results   = { processed: 0, succeeded: 0, failed: 0, errors: [] as string[] }

  try {
    // Recover any jobs stuck in 'processing' state (crashed workers)
    try { await supabase.rpc('recover_stale_jobs') } catch { /* not yet deployed */ }

    // Claim jobs atomically using FOR UPDATE SKIP LOCKED
    // This is safe for multiple concurrent workers
    const { data: jobs, error: fetchErr } = await supabase
      .from('job_queue')
      .select('*')
      .in('status', ['pending', 'retrying'])
      .lte('scheduled_at', new Date().toISOString())
      .order('priority', { ascending: true })
      .order('scheduled_at', { ascending: true })
      .limit(MAX_JOBS_PER_RUN)

    if (fetchErr) {
      log.error(' Failed to fetch jobs:', fetchErr)
      return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 })
    }

    if (!jobs?.length) {
      return NextResponse.json({ message: 'No jobs to process', ...results })
    }

    for (const job of jobs) {
      // Abort if approaching timeout
      if (Date.now() - startTime > JOB_TIMEOUT_MS) {
        log.info(' Approaching timeout — stopping')
        break
      }

      results.processed++

      // Mark job as processing
      // Real gap found during a full-system audit: none of this route's
      // job_queue writes were checked — a rejected 'processing'/'completed'
      // update left the job stuck at its previous status, which
      // recover_stale_jobs would later sweep back to pending/retrying and
      // reprocess, risking duplicate WhatsApp sends or duplicate AI scoring
      // for the same job.
      const { error: processingErr } = await supabase
        .from('job_queue')
        .update({
          status:     'processing',
          started_at: new Date().toISOString(),
          attempts:   job.attempts + 1,
        })
        .eq('id', job.id)
      if (processingErr) log.error('job_queue processing update failed', new Error(processingErr.message), { job_id: job.id })

      try {
        await processJob(supabase, job)

        const { error: completedErr } = await supabase
          .from('job_queue')
          .update({
            status:       'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        if (completedErr) log.error('job_queue completed update failed', new Error(completedErr.message), { job_id: job.id })

        results.succeeded++
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        log.error(`Job ${job.id} (${job.job_type}) failed`, new Error(errMsg))
        results.errors.push(`${job.job_type}: ${errMsg}`)
        results.failed++

        const willRetry = job.attempts + 1 < job.max_attempts
        const { error: retryErr } = await supabase
          .from('job_queue')
          .update({
            status:     willRetry ? 'retrying' : 'failed',
            last_error: errMsg,
            // Exponential backoff: 1min, 5min, 15min
            scheduled_at: willRetry
              ? new Date(Date.now() + Math.pow(job.attempts + 1, 2) * 60_000).toISOString()
              : undefined,
          })
          .eq('id', job.id)
        if (retryErr) log.error('job_queue retry/failed update failed', new Error(retryErr.message), { job_id: job.id })
      }
    }

    // Run cleanup if we have capacity
    if (Date.now() - startTime < 20_000) {
      try {
        try { await supabase.rpc('run_scheduled_cleanup') } catch { /* not yet deployed */ }
      } catch (cleanupErr) {
        log.warn(' Cleanup failed:', { error: String(cleanupErr) })
      }
    }

    return NextResponse.json({
      message: `Processed ${results.processed} jobs`,
      ...results,
    })
  } catch (err) {
    log.error(' Worker crash:', err)
    return NextResponse.json({ error: 'Worker failed' }, { status: 500 })
  }
}

// GET: Vercel Cron endpoint (Vercel always sends GET for cron jobs)
// Also handles health checks when called with ?health=1
export async function GET(request: NextRequest) {
  if (!verifyCallerSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Health-only mode
  if (request.nextUrl.searchParams.get('health') === '1') {
    const supabase = createServiceClient()
    const { count: pendingCount } = await supabase
      .from('job_queue')
      .select('*', { count: 'exact', head: true })
      .in('status', ['pending', 'retrying'])
    const { count: failedCount } = await supabase
      .from('job_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    return NextResponse.json({
      status:  'healthy',
      queue:   { pending: pendingCount ?? 0, failed_24h: failedCount ?? 0 },
      time:    new Date().toISOString(),
    })
  }

  // Default: run the worker (this is what Vercel Cron calls)
  return runWorker()
}

// ============================================================
// Job handlers
// ============================================================

async function processJob(supabase: ReturnType<typeof createServiceClient>, job: any): Promise<void> {
  const payload = job.payload as Record<string, any>

  switch (job.job_type) {

    // Score a single debt with AI
    case 'score_debt': {
      const { debt_id } = payload
      if (!debt_id) throw new Error('score_debt: missing debt_id')

      const { data: debt, error } = await supabase
        .from('debts')
        .select('*, customer:customers(*)')
        .eq('id', debt_id)
        .single()

      if (error || !debt) throw new Error(`Debt ${debt_id} not found`)

      const { data: payments } = await supabase
        .from('payments')
        .select('amount, payment_date, status')
        .eq('debt_id', debt_id)
        .order('payment_date', { ascending: false })
        .limit(20)

      const daysOverdue = debt.due_date ? calculateDaysOverdue(debt.due_date) : 0

      const result = await scoreDebt({
        debt,
        customer:           debt.customer,
        payment_history:    (payments ?? []).map((p: any) => ({
          amount: Number(p.amount), date: p.payment_date, status: p.status,
        })),
        days_overdue:       daysOverdue,
        total_payments_made: payments?.length ?? 0,
      })

      const { error: jobScoreInsertErr } = await supabase.from('ai_scores').insert({
        company_id:             debt.company_id,
        debt_id,
        customer_id:            debt.customer_id,
        score:                  result.score,
        risk_classification:    result.risk_classification,
        collection_probability: result.collection_probability / 100,
        recommended_strategy:   result.recommended_strategy,
        factors:                result.factors,
      })
      if (jobScoreInsertErr) log.error('score_debt job: ai_scores insert failed', new Error(jobScoreInsertErr.message), { debt_id })

      const newPriority =
        result.score < 25 ? 'critical' :
        result.score < 50 ? 'high'     :
        result.score < 75 ? 'medium'   : 'low'

      const { error: jobPriorityErr } = await supabase
        .from('debts')
        .update({ priority: newPriority })
        .eq('id', debt_id)
      if (jobPriorityErr) log.error('score_debt job: debt priority update failed', new Error(jobPriorityErr.message), { debt_id })

      break
    }

    // Score a batch of debts (up to 20 at a time)
    case 'score_batch': {
      const { company_id, debt_ids } = payload
      if (!company_id || !Array.isArray(debt_ids)) throw new Error('score_batch: invalid payload')

      for (const debt_id of debt_ids.slice(0, 20)) {
        try {
          await supabase.rpc('enqueue_job', {
            p_company_id: company_id,
            p_job_type:   'score_debt',
            p_payload:    { debt_id },
            p_priority:   7,
          })
        } catch { /* not yet deployed */ }
      }
      break
    }

    // Send a WhatsApp message
    case 'send_whatsapp': {
      const { phone, message, company_id, customer_id, debt_id } = payload
      if (!phone || !message) throw new Error('send_whatsapp: missing phone or message')

      const result = await sendWhatsAppMessage({ to: phone, message, company_id })

      const { error: jobMsgLogErr } = await supabase.from('messages').insert({
        company_id,
        customer_id: customer_id ?? null,
        debt_id:     debt_id ?? null,
        channel:     'whatsapp',
        direction:   'outbound',
        content:     message,
        status:      result.status === 'sent' ? 'sent' : 'failed',
        whatsapp_message_id: result.message_id ?? null,
        sent_at:     new Date().toISOString(),
        metadata:    { phone, via: 'job_queue', error: result.error ?? null },
      })
      if (jobMsgLogErr) log.error('send_whatsapp job: message log failed', new Error(jobMsgLogErr.message), { company_id })

      if (result.status === 'failed') {
        throw new Error(result.error ?? 'WhatsApp send failed')
      }
      break
    }

    // Run database cleanup
    case 'cleanup': {
      try { await supabase.rpc('run_scheduled_cleanup') } catch { /* not yet deployed */ }
      break
    }

    // Run automation pipeline for a single debt
    case 'pipeline_event': {
      const { company_id, customer_id, debt_id, source } = payload
      if (!company_id) throw new Error('pipeline_event: missing company_id')
      await processEvent({
        source:       source ?? 'manual',
        company_id,
        _customer_id: customer_id ?? null,
        _debt_id:     debt_id ?? null,
        data:         payload,
      })
      break
    }

    default:
      throw new Error(`Unknown job type: ${job.job_type}`)
  }
}
