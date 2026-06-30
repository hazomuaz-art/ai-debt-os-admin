import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import type { AlertSeverity } from '@/types/index'

const log = createLogger('system-alerts')

// Same structural-guard pattern as insertTimelineEvent() (src/lib/timeline.ts):
// severity is typed against the real system_alerts_severity_check (info/
// warning/error/critical) so a typo like the 'high' found in the
// full-system audit (2026-06-29) is a compile error now, not a silent
// failed insert discovered later. alert_type has no DB constraint (free
// text), so it stays a plain string.
export async function insertSystemAlert(row: {
  company_id: string | null
  severity: AlertSeverity
  alert_type: string
  title: string
  message: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('system_alerts').insert({
    company_id: row.company_id, severity: row.severity, alert_type: row.alert_type,
    title: row.title, message: row.message, metadata: row.metadata ?? {},
    is_read: false, is_resolved: false,
  })
  if (error) log.error('system_alerts insert failed', new Error(error.message), { alert_type: row.alert_type })
}
