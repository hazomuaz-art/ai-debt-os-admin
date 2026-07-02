create table if not exists customer_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  debt_id uuid references debts(id) on delete set null,
  doc_type text not null check (doc_type in (
    'receipt', 'account_statement', 'letter', 'court_judgment',
    'proof_of_payment', 'debt_waiver', 'id_document', 'other'
  )),
  needs_admin_review boolean not null default false,
  ai_summary text,
  ai_confidence numeric,
  storage_path text,
  source text not null default 'whatsapp',
  raw_analysis jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_documents_customer on customer_documents(customer_id);
create index if not exists idx_customer_documents_debt on customer_documents(debt_id);
create index if not exists idx_customer_documents_company on customer_documents(company_id);

alter table customer_documents enable row level security;

create policy "company_scoped_select_customer_documents" on customer_documents
  for select using (company_id = (auth.jwt() -> 'app_metadata' ->> 'company_id')::uuid
    or (auth.jwt() -> 'app_metadata' ->> 'company_id') = (select id::text from companies where slug = 'platform-owner' limit 1));

create policy "service_role_all_customer_documents" on customer_documents
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
