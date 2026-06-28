-- ================================================================
-- MIGRATION 017: Enterprise Foundation
-- Adds tables for: tenant lifecycle, limit enforcement, WhatsApp
-- live config, revenue attribution, payment verification,
-- automation engine, AI collector cloning, monitoring/audit,
-- self-healing.
-- ALL ADD-ONLY — no DROP, no ALTER existing columns.
-- IDEMPOTENT — safe to run multiple times.
-- ================================================================
BEGIN;

-- ----------------------------------------------------------------
-- 1. TENANT EVENTS — lifecycle audit trail
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL
               CHECK (event_type IN (
                 'created','activated','suspended','cancelled',
                 'plan_changed','limit_changed','trial_started','trial_ended'
               )),
  old_value    JSONB DEFAULT '{}',
  new_value    JSONB DEFAULT '{}',
  actor_id     UUID REFERENCES public.profiles(id),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.tenant_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_events' AND policyname='te_select') THEN
    CREATE POLICY "te_select" ON public.tenant_events FOR SELECT
      USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'));
    CREATE POLICY "te_insert" ON public.tenant_events FOR INSERT WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_tenant_events_company ON public.tenant_events (company_id, created_at DESC);

-- ----------------------------------------------------------------
-- 2. LIMIT ENFORCEMENT LOG — tracks every enforcement decision
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.limit_enforcement_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  limit_type   TEXT NOT NULL,      -- daily_ai_actions, monthly_whatsapp, etc.
  action_type  TEXT NOT NULL,      -- allowed | blocked | degraded
  current_val  INTEGER NOT NULL,
  limit_val    INTEGER NOT NULL,
  fallback     TEXT,               -- rules | memory | manual
  context      JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.limit_enforcement_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='limit_enforcement_log' AND policyname='lel_select') THEN
    CREATE POLICY "lel_select" ON public.limit_enforcement_log FOR SELECT
      USING (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin');
    CREATE POLICY "lel_insert" ON public.limit_enforcement_log FOR INSERT WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_lel_company ON public.limit_enforcement_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lel_blocked ON public.limit_enforcement_log (company_id, limit_type)
  WHERE action_type = 'blocked';

-- ----------------------------------------------------------------
-- 3. WHATSAPP LIVE CONFIG — per-company live WA credentials
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_config (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
  phone_number_id       TEXT,
  access_token_enc      TEXT,          -- encrypted in application layer
  verify_token          TEXT,
  business_account_id   TEXT,
  webhook_url           TEXT,
  is_active             BOOLEAN NOT NULL DEFAULT false,
  last_tested_at        TIMESTAMPTZ,
  last_test_ok          BOOLEAN,
  daily_limit           INTEGER DEFAULT 500,
  monthly_limit         INTEGER DEFAULT 5000,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='whatsapp_config' AND policyname='wc_select') THEN
    CREATE POLICY "wc_select" ON public.whatsapp_config FOR SELECT
      USING (company_id = public.get_user_company_id());
    CREATE POLICY "wc_write" ON public.whatsapp_config FOR ALL
      USING (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin')
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 4. REVENUE ATTRIBUTION — link payments to collection channel
-- (table already exists in migration 013 as collection_attribution;
--  this adds a richer revenue_events table)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_id       UUID REFERENCES public.payments(id),
  customer_id      UUID REFERENCES public.customers(id),
  debt_id          UUID REFERENCES public.debts(id),
  amount           DECIMAL(15,2) NOT NULL,
  currency         TEXT DEFAULT 'SAR',
  attribution_channel TEXT NOT NULL DEFAULT 'unknown'
    CHECK (attribution_channel IN (
      'whatsapp','call','ai_call','email','sms',
      'collector','campaign','self_service','unknown'
    )),
  attribution_actor TEXT NOT NULL DEFAULT 'unknown'
    CHECK (attribution_actor IN ('ai','collector','ai_assisted','campaign','customer','unknown')),
  ai_assisted      BOOLEAN DEFAULT false,
  rule_triggered   BOOLEAN DEFAULT false,
  memory_used      BOOLEAN DEFAULT false,
  campaign_id      UUID REFERENCES public.campaigns(id),
  collector_id     UUID REFERENCES public.profiles(id),
  portfolio_id     UUID REFERENCES public.portfolios(id),
  touches_before   INTEGER DEFAULT 1,
  days_to_collect  INTEGER,
  cost_of_collection DECIMAL(10,4) DEFAULT 0,
  roi              DECIMAL(8,2),    -- (amount - cost) / cost * 100
  metadata         JSONB DEFAULT '{}',
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.revenue_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='revenue_events' AND policyname='re_select') THEN
    CREATE POLICY "re_select" ON public.revenue_events FOR SELECT
      USING (company_id = public.get_user_company_id());
    CREATE POLICY "re_insert" ON public.revenue_events FOR INSERT
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_rev_company ON public.revenue_events (company_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_rev_channel ON public.revenue_events (company_id, attribution_channel);

-- ----------------------------------------------------------------
-- 5. PAYMENT VERIFICATION — track verification attempts
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_verifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_id      UUID REFERENCES public.payments(id),
  debt_id         UUID NOT NULL REFERENCES public.debts(id),
  customer_id     UUID NOT NULL REFERENCES public.customers(id),
  method          TEXT NOT NULL DEFAULT 'receipt'
    CHECK (method IN ('receipt','bank_statement','reference_check','manual','auto')),
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verified','rejected','needs_review')),
  reference_no    TEXT,
  amount_claimed  DECIMAL(15,2),
  amount_verified DECIMAL(15,2),
  verified_by     UUID REFERENCES public.profiles(id),
  rejection_reason TEXT,
  evidence_urls   TEXT[],
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.payment_verifications ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='payment_verifications' AND policyname='pv_select') THEN
    CREATE POLICY "pv_select" ON public.payment_verifications FOR SELECT
      USING (company_id = public.get_user_company_id());
    CREATE POLICY "pv_write" ON public.payment_verifications FOR ALL
      USING (company_id = public.get_user_company_id())
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_pv_pending ON public.payment_verifications (company_id, status)
  WHERE status = 'pending';

-- ----------------------------------------------------------------
-- 6. AUTOMATION RUNS — log every automation engine execution
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_runs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  run_type        TEXT NOT NULL
    CHECK (run_type IN ('scheduled','manual','triggered','test')),
  mode            TEXT NOT NULL DEFAULT 'off'
    CHECK (mode IN ('off','test','live')),
  status          TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','completed','failed','skipped')),
  actions_planned INTEGER DEFAULT 0,
  actions_executed INTEGER DEFAULT 0,
  actions_skipped  INTEGER DEFAULT 0,
  cost_usd        DECIMAL(10,4) DEFAULT 0,
  error_log       JSONB DEFAULT '[]',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  triggered_by    UUID REFERENCES public.profiles(id)
);
ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='automation_runs' AND policyname='ar_select') THEN
    CREATE POLICY "ar_select" ON public.automation_runs FOR SELECT
      USING (company_id = public.get_user_company_id());
    CREATE POLICY "ar_insert" ON public.automation_runs FOR INSERT WITH CHECK (true);
    CREATE POLICY "ar_update" ON public.automation_runs FOR UPDATE
      USING (company_id = public.get_user_company_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_auto_runs_company ON public.automation_runs (company_id, started_at DESC);

-- ----------------------------------------------------------------
-- 7. AI COLLECTOR PROFILES — collector persona definitions
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_collector_profiles (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  persona_type    TEXT NOT NULL DEFAULT 'standard'
    CHECK (persona_type IN ('standard','firm','empathetic','negotiator','legal')),
  language        TEXT DEFAULT 'ar',
  dialect         TEXT DEFAULT 'Saudi',
  tone            TEXT DEFAULT 'professional',
  max_daily_calls INTEGER DEFAULT 50,
  call_hours_start TIME DEFAULT '09:00',
  call_hours_end   TIME DEFAULT '18:00',
  success_rate     DECIMAL(5,2) DEFAULT 0,
  calls_made       INTEGER DEFAULT 0,
  is_active        BOOLEAN DEFAULT true,
  system_prompt    TEXT,
  metadata         JSONB DEFAULT '{}',
  cloned_from      UUID REFERENCES public.ai_collector_profiles(id),
  created_by       UUID REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.ai_collector_profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_collector_profiles' AND policyname='acp_select') THEN
    CREATE POLICY "acp_select" ON public.ai_collector_profiles FOR SELECT
      USING (company_id = public.get_user_company_id());
    CREATE POLICY "acp_write" ON public.ai_collector_profiles FOR ALL
      USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

-- ----------------------------------------------------------------
-- 8. SYSTEM HEALTH CHECKS — monitoring snapshots
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.health_checks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  check_type   TEXT NOT NULL
    CHECK (check_type IN (
      'openai','whatsapp','supabase','job_queue',
      'rate_limits','memory','rules','overall'
    )),
  status       TEXT NOT NULL
    CHECK (status IN ('ok','degraded','down','unknown')),
  latency_ms   INTEGER,
  message      TEXT,
  metadata     JSONB DEFAULT '{}',
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.health_checks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='health_checks' AND policyname='hc_select') THEN
    CREATE POLICY "hc_select" ON public.health_checks FOR SELECT
      USING (company_id IS NULL OR company_id = public.get_user_company_id());
    CREATE POLICY "hc_insert" ON public.health_checks FOR INSERT WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_hc_type_time ON public.health_checks (check_type, checked_at DESC);

-- ----------------------------------------------------------------
-- 9. AUDIT LOG EXTENDED — detailed action log
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  actor_id     UUID REFERENCES public.profiles(id),
  actor_email  TEXT,
  action       TEXT NOT NULL,
  resource     TEXT NOT NULL,   -- table/entity name
  resource_id  TEXT,
  old_data     JSONB,
  new_data     JSONB,
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='audit_log' AND policyname='al_select') THEN
    CREATE POLICY "al_select" ON public.audit_log FOR SELECT
      USING (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin');
    CREATE POLICY "al_insert" ON public.audit_log FOR INSERT WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_al_company ON public.audit_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_al_actor ON public.audit_log (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- ----------------------------------------------------------------
-- 10. SELF HEALING ACTIONS — automated recovery log
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.self_healing_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  trigger_event   TEXT NOT NULL,   -- what caused the healing
  healing_action  TEXT NOT NULL,   -- what was done
  status          TEXT NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied','failed','skipped','manual_override')),
  before_state    JSONB DEFAULT '{}',
  after_state     JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.self_healing_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='self_healing_log' AND policyname='shl_select') THEN
    CREATE POLICY "shl_select" ON public.self_healing_log FOR SELECT
      USING (company_id IS NULL OR company_id = public.get_user_company_id());
    CREATE POLICY "shl_insert" ON public.self_healing_log FOR INSERT WITH CHECK (true);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_shl_company ON public.self_healing_log (company_id, created_at DESC);

-- ----------------------------------------------------------------
-- Seed: default AI Collector profile for demo company
-- ----------------------------------------------------------------
INSERT INTO public.ai_collector_profiles
  (company_id, name, persona_type, language, dialect, tone, system_prompt, is_active)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'Standard Collector', 'standard', 'ar', 'Saudi', 'professional',
   'You are a professional debt collection agent. Be respectful, firm, and solution-oriented.',
   true)
ON CONFLICT DO NOTHING;

COMMIT;
