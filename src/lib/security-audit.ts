import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('security-audit')

export type SecurityEventType =
  | 'login_success' | 'login_failed' | 'logout'
  | 'mfa_enrolled' | 'mfa_challenge_success' | 'mfa_challenge_failed'
  | 'role_changed' | 'user_activated' | 'user_deactivated' | 'user_invited'
  | 'data_export' | 'data_deletion'

// Separate from the business audit trail (timeline_events) - this is the
// security-relevant trail NCA ECC / PDPL expect (who logged in, from where,
// who changed a privileged setting). Never blocks or throws - a logging
// failure must never break the action it is logging.
export async function logSecurityEvent(args: {
  company_id?:    string | null
  actor_user_id?: string | null
  actor_email?:   string | null
  event_type:     SecurityEventType
  ip_address?:    string | null
  user_agent?:    string | null
  metadata?:      Record<string, unknown>
}): Promise<void> {
  try {
    const svc = createServiceClient()
    const { error } = await svc.from('security_audit_log').insert({
      company_id:    args.company_id ?? null,
      actor_user_id: args.actor_user_id ?? null,
      actor_email:   args.actor_email ?? null,
      event_type:    args.event_type,
      ip_address:    args.ip_address ?? null,
      user_agent:    args.user_agent ?? null,
      metadata:      args.metadata ?? {},
    })
    if (error) log.error('security_audit_log insert failed', new Error(error.message), { event_type: args.event_type })
  } catch (err) {
    log.error('logSecurityEvent failed', err as Error, { event_type: args.event_type })
  }
}

// Best-effort client IP/user-agent extraction from a Next.js server-side
// request context (Server Actions don't get a Request object directly, so
// callers in actions read these from next/headers themselves and pass them
// in - this helper is for API routes that do have a NextRequest).
export function extractRequestMeta(req: { headers: Headers }): { ip: string | null; userAgent: string | null } {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || null
  const userAgent = req.headers.get('user-agent') ?? null
  return { ip, userAgent }
}
