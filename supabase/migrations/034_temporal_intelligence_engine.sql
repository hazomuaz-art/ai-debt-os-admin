-- Temporal Intelligence Engine — Knowledge Base + Learning Capture schema.
-- Phase 0: tables only, purely additive, zero impact on existing behavior.
-- Nothing in the live agent reads/writes these tables yet (Strangler Pattern
-- — wiring happens in later integration phases, in shadow mode first).

-- ════════════════════════════════════════════════════════════════════
-- 1) Spelling variants — replaces the hardcoded normalizeTemporalText()
--    word list in ai-collector-agent.ts with KB-driven, updatable data.
-- ════════════════════════════════════════════════════════════════════
create table if not exists temporal_spelling_variants (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'SA',
  canonical_word text not null,
  variant_word text not null,
  word_type text not null,  -- 'month_marker' | 'week_marker' | 'weekday' | 'commitment_verb' | ...
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (country_code, variant_word, word_type)
);

-- ════════════════════════════════════════════════════════════════════
-- 2) Official holidays/calendar events per country/year.
-- ════════════════════════════════════════════════════════════════════
create table if not exists temporal_holidays (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'SA',
  holiday_key text not null,            -- 'eid_fitr' | 'eid_adha' | 'ramadan_start' | 'hajj_start' | ...
  year int not null,
  start_date date not null,
  end_date date not null,
  calendar_type text not null default 'gregorian' check (calendar_type in ('gregorian','hijri')),
  created_at timestamptz not null default now(),
  unique (country_code, holiday_key, year)
);

-- ════════════════════════════════════════════════════════════════════
-- 3) Government support programs — payout-day knowledge, never hardcoded.
--    company_id NULL = country-wide default; set = company-specific override.
-- ════════════════════════════════════════════════════════════════════
create table if not exists temporal_gov_programs (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'SA',
  company_id uuid references companies(id) on delete cascade,
  program_key text not null,            -- 'citizen_account' | 'social_security' | 'saned' | ...
  display_name_ar text not null,
  payout_day_of_month int check (payout_day_of_month between 1 and 31),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════
-- 4) Per-country defaults (timezone, calendar, weekend) — opens the door to
--    UAE/Kuwait/Qatar/Bahrain/Egypt later by adding a row, not rewriting code.
-- ════════════════════════════════════════════════════════════════════
create table if not exists temporal_country_config (
  country_code text primary key,
  default_timezone text not null,
  default_calendar text not null default 'gregorian' check (default_calendar in ('gregorian','hijri')),
  weekend_days int[] not null,          -- ISO weekday numbers, e.g. {5,6} = Fri/Sat for Saudi
  default_salary_day int check (default_salary_day between 1 and 31),
  created_at timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════
-- 5) Known composite patterns ("بعد الراتب بأسبوع") — deterministic
--    interpretation rules, never inferred at runtime.
-- ════════════════════════════════════════════════════════════════════
create table if not exists temporal_composite_patterns (
  id uuid primary key default gen_random_uuid(),
  country_code text not null default 'SA',
  pattern_key text not null unique,     -- 'salary_then_offset' | 'gov_program_then_offset' | ...
  description_ar text not null,
  base_reference_type text not null,    -- which resolver supplies the base date
  offset_direction text not null check (offset_direction in ('add','subtract')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════
-- 6) Business calendar — how a company treats a date landing on a holiday.
-- ════════════════════════════════════════════════════════════════════
create table if not exists temporal_business_calendar (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  country_code text not null default 'SA',
  weekend_days int[],                                   -- null = inherit from temporal_country_config
  observes_public_holidays boolean not null default true,
  fallback_rule text not null default 'keep_as_is'
    check (fallback_rule in ('next_business_day','previous_business_day','keep_as_is')),
  created_at timestamptz not null default now(),
  unique (company_id)
);

-- ════════════════════════════════════════════════════════════════════
-- 7) Learning capture — every temporal expression NO resolver recognized at
--    all (not the already-classified "vague/ambiguous" cases). Pure data
--    capture for human-curated future KB updates — never auto-applied.
-- ════════════════════════════════════════════════════════════════════
create table if not exists temporal_learning (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete set null,
  portfolio_id uuid references portfolios(id) on delete set null,
  country_code text not null default 'SA',
  customer_id uuid references customers(id) on delete set null,
  debt_id uuid references debts(id) on delete set null,
  source_expression text not null,
  full_message_text text,
  engine_failure_reason text,
  detected_at timestamptz not null,
  outcome_status text not null default 'pending'
    check (outcome_status in ('pending','resolved_promise','resolved_payment','no_outcome')),
  outcome_resolved_at timestamptz,
  outcome_debt_id_ref uuid references debts(id) on delete set null,
  staff_interpretation text,
  staff_reviewed_by uuid references profiles(id) on delete set null,
  staff_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_temporal_learning_outcome_pending
  on temporal_learning (detected_at) where outcome_status = 'pending';
create index if not exists idx_temporal_learning_expression
  on temporal_learning (country_code, source_expression);

-- ════════════════════════════════════════════════════════════════════
-- Seed data — Saudi Arabia defaults only (today's single supported country).
-- ════════════════════════════════════════════════════════════════════
insert into temporal_country_config (country_code, default_timezone, default_calendar, weekend_days, default_salary_day)
values ('SA', 'Asia/Riyadh', 'gregorian', array[5,6], 27)
on conflict (country_code) do nothing;

insert into temporal_spelling_variants (country_code, canonical_word, variant_word, word_type) values
  ('SA', 'بداية', 'بدايه', 'month_week_marker'),
  ('SA', 'نهاية', 'نهايه', 'month_week_marker'),
  ('SA', 'الجمعة', 'الجمعه', 'weekday'),
  ('SA', 'الأسبوع', 'الاسبوع', 'week_unit'),
  ('SA', 'أول', 'اول', 'month_week_marker'),
  ('SA', 'آخر', 'اخر', 'month_week_marker'),
  ('SA', 'الأحد', 'الاحد', 'weekday'),
  ('SA', 'الإثنين', 'الاثنين', 'weekday'),
  ('SA', 'الأربعاء', 'الاربعاء', 'weekday')
on conflict (country_code, variant_word, word_type) do nothing;

insert into temporal_gov_programs (country_code, program_key, display_name_ar, payout_day_of_month) values
  ('SA', 'citizen_account', 'حساب المواطن', 10),
  ('SA', 'social_security', 'الضمان الاجتماعي', 1),
  ('SA', 'saned', 'ساند', 1),
  ('SA', 'pension', 'التأمينات/التقاعد', 1),
  ('SA', 'hafiz', 'حافز', 5)
on conflict do nothing;

insert into temporal_composite_patterns (country_code, pattern_key, description_ar, base_reference_type, offset_direction) values
  ('SA', 'salary_then_offset', 'بعد الراتب + إضافة فترة (مثل: بعد الراتب بأسبوع)', 'salary', 'add'),
  ('SA', 'gov_program_then_offset', 'بعد برنامج حكومي + إضافة فترة', 'gov_program', 'add'),
  ('SA', 'holiday_then_offset', 'بعد عطلة رسمية + إضافة فترة (مثل: بعد العيد بأسبوع)', 'holiday', 'add')
on conflict (pattern_key) do nothing;
