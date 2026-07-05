import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { insertSystemAlert } from '@/lib/system-alerts'
import { createLogger } from '@/lib/logger'

const log = createLogger('cron/data-retention-review')

// PDPL requires a defined retention/deletion schedule rather than keeping
// personal data indefinitely. This is deliberately REPORT-ONLY - it flags
// fully-resolved, fully-inactive records for a human admin to review and
// decide on, never auto-deletes anything. Getting a legally-mandated
// retention period wrong in either direction is exactly the kind of
// irreversible mistake that should never be made unilaterally by a script;
// the actual retention period below is a conservative placeholder pending
// confirmation from legal/compliance counsel, not a final policy decision.
const RETENTION_YEARS = 5
const RESOLVED_STATUSES = ['settled', 'written_off']

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.APP_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.APP_SECRET || process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS)
  const cutoffIso = cutoff.toISOString()

  // Candidates: resolved debts with no activity of any kind since the
  // cutoff. Checked per-company since each company may want to review its
  // own list separately.
  const { data: candidates, error } = await supabase
    .from('debts')
    .select('id, company_id, customer_id, reference_number, status, updated_at')
    .in('status', RESOLVED_STATUSES)
    .lt('updated_at', cutoffIso)

  if (error) {
    log.error('data-retention-review: failed to query candidates', new Error(error.message))
    return NextResponse.json({ error: 'query failed' }, { status: 500 })
  }

  const byCompany = new Map<string, typeof candidates>()
  for (const d of candidates ?? []) {
    if (!byCompany.has(d.company_id)) byCompany.set(d.company_id, [])
    byCompany.get(d.company_id)!.push(d)
  }

  let alertsRaised = 0
  for (const [companyId, debts] of byCompany.entries()) {
    const { data: existing } = await supabase
      .from('system_alerts')
      .select('id')
      .eq('company_id', companyId)
      .eq('alert_type', 'data_retention_review_due')
      .eq('is_resolved', false)
      .limit(1).maybeSingle()
    if (existing) continue // don't spam a fresh alert every run while one is still open

    await insertSystemAlert({
      company_id: companyId,
      severity: 'info',
      alert_type: 'data_retention_review_due',
      title: `${debts!.length} مديونية مغلقة تجاوزت ${RETENTION_YEARS} سنوات بدون نشاط`,
      message: `هذي السجلات مؤهلة للمراجعة حسب سياسة الاحتفاظ بالبيانات (PDPL). لم يتم حذف أي شي تلقائياً - المراجعة والقرار يدوي من الإدارة.`,
      metadata: { debt_ids: debts!.map(d => d.id), retention_years: RETENTION_YEARS },
    })
    alertsRaised++
  }

  log.info('data-retention-review run', { candidates: candidates?.length ?? 0, companies_flagged: byCompany.size, alerts_raised: alertsRaised })
  return NextResponse.json({ message: 'done', result: { candidates: candidates?.length ?? 0, alerts_raised: alertsRaised } })
}
