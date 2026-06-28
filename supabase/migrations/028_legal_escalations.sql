BEGIN;

-- Legal Escalation Engine: an independent escalation record + a hard
-- negotiation lock. While an escalation is open for a debt, the normal
-- agent (خالد) never replies — only the fixed "إدارة الشؤون القانونية"
-- persona does, deterministically, with zero LLM calls. The lock can only
-- be lifted by an admin/manager closing the escalation.

create table if not exists legal_escalations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  customer_id   uuid not null references customers(id),
  debt_id       uuid not null references debts(id),
  portfolio_id  uuid references portfolios(id),
  escalation_type text not null check (escalation_type in (
    'legal_threat','lawyer_mention','complaint','fault_dispute',
    'recourse_dispute','third_party_dispute','recovered_deduction','playbook_mandated'
  )),
  reason        text not null,
  status        text not null default 'open' check (status in ('open','closed')),
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  closed_by     uuid references profiles(id),
  admin_notes   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One OPEN escalation per debt at a time — the negotiation lock checks this.
create unique index if not exists uq_legal_escalations_open_per_debt
  on legal_escalations(debt_id) where status = 'open';

create index if not exists idx_legal_escalations_company on legal_escalations(company_id);
create index if not exists idx_legal_escalations_customer on legal_escalations(customer_id);

alter table legal_escalations enable row level security;

create policy "legal_escalations_company_isolation" on legal_escalations
  for all
  using (company_id = public.get_user_company_id())
  with check (company_id = public.get_user_company_id());

COMMIT;
