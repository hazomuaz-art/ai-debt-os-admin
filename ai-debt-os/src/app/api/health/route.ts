import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { validateEnv, isWhatsAppConfigured, isOpenAIConfigured } from '@/lib/env'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startTime = Date.now()

  const checks: Record<string, { status: 'ok' | 'error' | 'warn'; message?: string }> = {}

  // 1. Environment
  const envResult = validateEnv()
  checks.env = envResult.valid
    ? { status: 'ok' }
    : {
        status:  'error',
        message: [
          ...envResult.missing.map(k => `missing: ${k}`),
          ...envResult.invalid.map(({ key, message }) => `invalid: ${key} — ${message}`),
        ].join('; '),
      }

  // 2. Database connectivity
  try {
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('companies')
      .select('id')
      .limit(1)

    checks.database = error
      ? { status: 'error', message: error.message }
      : { status: 'ok' }
  } catch (err) {
    checks.database = {
      status:  'error',
      message: err instanceof Error ? err.message : 'Connection failed',
    }
  }

  // 3. Job queue health
  try {
    const supabase = createServiceClient()
    const { count: stuckJobs } = await supabase
      .from('job_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'processing')
      .lt('started_at', new Date(Date.now() - 15 * 60_000).toISOString())

    checks.job_queue = (stuckJobs ?? 0) > 5
      ? { status: 'warn', message: `${stuckJobs} stuck jobs` }
      : { status: 'ok' }
  } catch {
    checks.job_queue = { status: 'warn', message: 'Could not check job queue' }
  }

  // 4. External integrations
  checks.openai    = isOpenAIConfigured()    ? { status: 'ok' } : { status: 'warn', message: 'Not configured' }
  checks.whatsapp  = isWhatsAppConfigured()  ? { status: 'ok' } : { status: 'warn', message: 'Not configured' }

  const allOk = Object.values(checks).every(c => c.status !== 'error')
  const httpStatus = allOk ? 200 : 503

  return NextResponse.json(
    {
      status:   allOk ? 'healthy' : 'unhealthy',
      checks,
      latency_ms: Date.now() - startTime,
      timestamp:  new Date().toISOString(),
      version:    process.env.npm_package_version ?? '0.0.1',
    },
    { status: httpStatus }
  )
}
