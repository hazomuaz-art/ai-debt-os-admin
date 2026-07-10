BEGIN;

create table if not exists unmatched_contacts (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  attempts_count int not null default 0,
  last_message text,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'given_up')),
  matched_customer_id uuid references customers(id),
  matched_debt_id uuid references debts(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table unmatched_contacts enable row level security;

COMMIT;
