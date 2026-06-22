-- Agent Gaps Fix (§0-§9 spec): identity verification, opt-out, and
-- cross-message conversation state. All conversation-scoped state lives on
-- `customers` (not `debts`) — identity/opt-out/pending-clarification are
-- properties of the PERSON texting us, not of a specific debt.

-- §1: Identity verification gate. customers.national_id already exists
-- (001_initial_schema.sql) and holds the full ID/iqama number — we never
-- duplicate it; the gate compares only the last 4 digits extracted at
-- runtime.
alter table customers
  add column if not exists verification_status text not null default 'unverified'
    check (verification_status in ('unverified', 'verified', 'locked')),
  add column if not exists verification_attempts_count int not null default 0,
  add column if not exists verified_at timestamptz;

create table if not exists verification_attempts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  customer_id     uuid not null references customers(id) on delete cascade,
  field_challenged text not null check (field_challenged in ('national_id_last4', 'date_of_birth')),
  success         boolean not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_verification_attempts_customer on verification_attempts(customer_id);

alter table verification_attempts enable row level security;

create policy "verification_attempts_company_isolation" on verification_attempts
  for all
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

-- §2: Stop-contact / opt-out gate.
alter table customers
  add column if not exists contact_opt_out boolean not null default false,
  add column if not exists contact_opt_out_at timestamptz;

-- §4: Multi-portfolio clarification memory — carries the customer's original
-- ambiguous message forward to the NEXT inbound message so a second intent
-- bundled into that first message is never lost. Cleared once consumed.
alter table customers
  add column if not exists pending_clarification jsonb;
