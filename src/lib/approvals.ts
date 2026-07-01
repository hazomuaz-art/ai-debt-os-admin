import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import type { ApprovalType } from '@/types/index'

const log = createLogger('approvals')

// Same structural-guard pattern as insertTimelineEvent()/insertSystemAlert().
// approval_type is typed against the real approvals_approval_type_check —
// the full-system audit (2026-06-29) found 'dispute' and 'payment_plan'
// being used, neither valid, both failing silently since each shipped.
// Most real-world approval requests should use 'custom' with a
// requested_data.request_subtype to distinguish what kind of custom
// request it is (see dispute.ts/installment-request.ts) — approval_type
// alone cannot disambiguate that, by design of the real constraint.
export async function insertApproval(row: {
  company_id: string
  approval_type: ApprovalType
  entity_type: string
  entity_id: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  requested_data?: Record<string, unknown>
  expires_at?: string
}): Promise<{ id: string } | null> {
  const supabase = createServiceClient()
  const { data, error } = await supabase.from('approvals').insert({
    company_id: row.company_id, approval_type: row.approval_type,
    entity_type: row.entity_type, entity_id: row.entity_id,
    title: row.title, description: row.description,
    status: 'pending', priority: row.priority,
    requested_data: row.requested_data ?? {},
    ...(row.expires_at ? { expires_at: row.expires_at } : {}),
  }).select('id').single()
  if (error) { log.error('approvals insert failed', new Error(error.message), { approval_type: row.approval_type }); return null }
  return data as { id: string }
}
