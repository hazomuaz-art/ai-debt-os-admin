create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  email text not null,
  full_name text not null,
  branch text,
  supervisor_name text,
  job_title text,
  portfolio_name text,
  portfolio_id uuid references portfolios(id) on delete set null,
  work_phone text,
  pbx_server text,
  pbx_extension text,
  pbx_connection_key text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  profile_id uuid references profiles(id) on delete set null,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);

create index if not exists idx_employees_company on employees(company_id);
create index if not exists idx_employees_portfolio on employees(portfolio_id) where portfolio_id is not null;
create index if not exists idx_employees_status on employees(company_id, status);

create table if not exists employee_history (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  change_type text not null check (change_type in ('created', 'updated', 'deactivated', 'reactivated')),
  field_changed text,
  old_value text,
  new_value text,
  changed_at timestamptz not null default now()
);

create index if not exists idx_employee_history_employee on employee_history(employee_id, changed_at desc);

alter table employees enable row level security;
alter table employee_history enable row level security;

create policy "View employees in company" on employees
  for select using (company_id = get_user_company_id());
create policy "Admins manage employees" on employees
  for all using (company_id = get_user_company_id() and get_user_role() = 'admin')
  with check (company_id = get_user_company_id() and get_user_role() = 'admin');

create policy "View employee_history in company" on employee_history
  for select using (exists (
    select 1 from employees e where e.id = employee_history.employee_id and e.company_id = get_user_company_id()
  ));
