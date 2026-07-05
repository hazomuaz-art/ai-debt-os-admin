-- Compliance hardening (2026-07-05): a separate SECURITY audit trail,
-- distinct from timeline_events (which logs business/collection events like
-- status changes and messages). NCA ECC and PDPL both expect visibility
-- into who logged in, from where, and who changed privileged settings -
-- none of which timeline_events was ever designed to capture.
create table if not exists security_audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  actor_user_id uuid references profiles(id) on delete set null,
  actor_email text,
  event_type text not null check (event_type in (
    'login_success', 'login_failed', 'logout',
    'mfa_enrolled', 'mfa_challenge_success', 'mfa_challenge_failed',
    'role_changed', 'user_activated', 'user_deactivated', 'user_invited',
    'data_export', 'data_deletion'
  )),
  ip_address text,
  user_agent text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_audit_log_company on security_audit_log(company_id);
create index if not exists idx_security_audit_log_actor on security_audit_log(actor_user_id);
create index if not exists idx_security_audit_log_event_type on security_audit_log(event_type);
create index if not exists idx_security_audit_log_created_at on security_audit_log(created_at);

alter table security_audit_log enable row level security;

-- Read-only for admins of their own company; all writes go through the
-- service-role client from server actions/routes, never client-side.
create policy "security_audit_log_admin_read" on security_audit_log
  for select
  using (company_id = get_user_company_id() and get_user_role() = 'admin');
