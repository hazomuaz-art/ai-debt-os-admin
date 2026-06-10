-- MIGRATION 020: Full Historical Sync Layer + Dynamic Status Mapping

-- 1) Store original statuses from any collection system without losing them
CREATE TABLE IF NOT EXISTS public.collection_status_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL DEFAULT 'collection_system',
  original_status TEXT NOT NULL,
  original_sub_status TEXT,
  original_status_code TEXT,
  normalized_status TEXT NOT NULL DEFAULT 'active',
  normalized_category TEXT NOT NULL DEFAULT 'unknown',
  ai_meaning TEXT,
  recommended_strategy TEXT,
  is_terminal BOOLEAN DEFAULT false,
  priority_weight INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, portfolio_id, source_system, original_status, original_sub_status, original_status_code)
);

-- 2) Historical follow-ups / collector notes / customer statements
CREATE TABLE IF NOT EXISTS public.collection_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id UUID REFERENCES public.debts(id) ON DELETE CASCADE,

  source_system TEXT NOT NULL DEFAULT 'collection_system',
  external_followup_id TEXT,
  external_customer_id TEXT,
  external_debt_id TEXT,

  followup_type TEXT,
  followup_channel TEXT,
  original_status TEXT,
  original_sub_status TEXT,
  normalized_status TEXT,
  collector_name TEXT,
  collector_external_id TEXT,
  customer_statement TEXT,
  collector_note TEXT,
  result_summary TEXT,
  next_follow_up_at TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ,
  raw_payload JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(company_id, source_system, external_followup_id)
);

-- 3) Status history exactly as it came from source
CREATE TABLE IF NOT EXISTS public.collection_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id UUID REFERENCES public.debts(id) ON DELETE CASCADE,

  source_system TEXT NOT NULL DEFAULT 'collection_system',
  external_status_id TEXT,
  external_customer_id TEXT,
  external_debt_id TEXT,

  old_status TEXT,
  old_sub_status TEXT,
  new_status TEXT NOT NULL,
  new_sub_status TEXT,
  normalized_status TEXT,
  changed_by_name TEXT,
  changed_by_external_id TEXT,
  changed_at TIMESTAMPTZ,
  raw_payload JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(company_id, source_system, external_status_id)
);

-- 4) Assignment history: who had the case and when
CREATE TABLE IF NOT EXISTS public.collection_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id UUID REFERENCES public.debts(id) ON DELETE CASCADE,

  source_system TEXT NOT NULL DEFAULT 'collection_system',
  external_assignment_id TEXT,
  external_customer_id TEXT,
  external_debt_id TEXT,

  assigned_to_name TEXT,
  assigned_to_external_id TEXT,
  assigned_by_name TEXT,
  assigned_by_external_id TEXT,
  assignment_status TEXT,
  assigned_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  raw_payload JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(company_id, source_system, external_assignment_id)
);

-- 5) Attachments / receipts / accident documents / policy docs / proof files
CREATE TABLE IF NOT EXISTS public.collection_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id UUID REFERENCES public.debts(id) ON DELETE CASCADE,

  source_system TEXT NOT NULL DEFAULT 'collection_system',
  external_attachment_id TEXT,
  external_customer_id TEXT,
  external_debt_id TEXT,

  attachment_type TEXT,
  file_name TEXT,
  file_url TEXT,
  mime_type TEXT,
  uploaded_by_name TEXT,
  uploaded_at TIMESTAMPTZ,
  description TEXT,
  raw_payload JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(company_id, source_system, external_attachment_id)
);

-- 6) Raw external case snapshots for full audit and future remapping
CREATE TABLE IF NOT EXISTS public.collection_external_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  debt_id UUID REFERENCES public.debts(id) ON DELETE SET NULL,

  source_system TEXT NOT NULL DEFAULT 'collection_system',
  external_customer_id TEXT,
  external_debt_id TEXT,
  external_case_id TEXT,

  snapshot_type TEXT NOT NULL DEFAULT 'case',
  payload JSONB NOT NULL DEFAULT '{}',
  payload_hash TEXT,
  source_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(company_id, source_system, external_case_id, snapshot_type, payload_hash)
);

-- 7) Extend debts to preserve original source fields
ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS external_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS external_case_id TEXT,
  ADD COLUMN IF NOT EXISTS original_status TEXT,
  ADD COLUMN IF NOT EXISTS original_sub_status TEXT,
  ADD COLUMN IF NOT EXISTS original_status_code TEXT,
  ADD COLUMN IF NOT EXISTS normalized_status TEXT,
  ADD COLUMN IF NOT EXISTS source_payload JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_source_synced_at TIMESTAMPTZ;

-- 8) Extend customers to preserve source IDs
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS external_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS source_payload JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_source_synced_at TIMESTAMPTZ;

-- 9) Indexes
CREATE INDEX IF NOT EXISTS idx_status_mappings_company_portfolio
  ON public.collection_status_mappings(company_id, portfolio_id, source_system);

CREATE INDEX IF NOT EXISTS idx_followups_customer_time
  ON public.collection_followups(company_id, customer_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_followups_debt_time
  ON public.collection_followups(company_id, debt_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_status_history_debt_time
  ON public.collection_status_history(company_id, debt_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_assignments_debt_time
  ON public.collection_assignments(company_id, debt_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_debt
  ON public.collection_attachments(company_id, debt_id, uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_snapshots_external_case
  ON public.collection_external_snapshots(company_id, source_system, external_case_id);

CREATE INDEX IF NOT EXISTS idx_debts_external_customer
  ON public.debts(company_id, external_customer_id) WHERE external_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_external_customer
  ON public.customers(company_id, external_customer_id) WHERE external_customer_id IS NOT NULL;

-- 10) Enable RLS
ALTER TABLE public.collection_status_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_external_snapshots ENABLE ROW LEVEL SECURITY;

-- 11) Simple company scoped RLS policies
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='collection_status_mappings' AND policyname='collection_status_mappings_company') THEN
    CREATE POLICY collection_status_mappings_company ON public.collection_status_mappings
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='collection_followups' AND policyname='collection_followups_company') THEN
    CREATE POLICY collection_followups_company ON public.collection_followups
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='collection_status_history' AND policyname='collection_status_history_company') THEN
    CREATE POLICY collection_status_history_company ON public.collection_status_history
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='collection_assignments' AND policyname='collection_assignments_company') THEN
    CREATE POLICY collection_assignments_company ON public.collection_assignments
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='collection_attachments' AND policyname='collection_attachments_company') THEN
    CREATE POLICY collection_attachments_company ON public.collection_attachments
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='collection_external_snapshots' AND policyname='collection_external_snapshots_company') THEN
    CREATE POLICY collection_external_snapshots_company ON public.collection_external_snapshots
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
END $$;
