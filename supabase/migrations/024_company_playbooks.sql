-- Phase 2: Company Playbooks — one policy row per portfolio, versioned.
-- The AI collector agent reads the latest active row for a portfolio
-- before replying. Independent table (not portfolios.metadata) so policy
-- can be audited/versioned without touching the portfolio record itself.

create table if not exists company_playbooks (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  portfolio_id    uuid not null references portfolios(id) on delete cascade,
  version         integer not null default 1,
  is_active       boolean not null default true,
  -- discounts/installments are POLICY ONLY — the agent never auto-approves
  -- them; this just defines what an admin is allowed to approve later.
  discounts       jsonb not null default '{"allowed": false, "max_percent": 0, "requires_admin_approval": true}',
  installments    jsonb not null default '{"allowed": false, "max_months": 0, "requires_admin_approval": true}',
  -- which case-file fields/topics this portfolio's agent replies may
  -- surface — category-specific (telecom vs insurance vs utility).
  fields_to_surface jsonb not null default '[]',
  -- dispute types this portfolio actually supports (insurance-only types
  -- like recourse/third_party/recovered_deduction must never appear here
  -- for a non-insurance portfolio — enforced again in code, not just data).
  allowed_dispute_types jsonb not null default '[]',
  notes           text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (portfolio_id, version)
);

create index if not exists idx_company_playbooks_portfolio_active
  on company_playbooks (portfolio_id, is_active);

alter table company_playbooks enable row level security;

create policy "company_playbooks_company_isolation" on company_playbooks
  for all
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());
