-- ============================================================
-- MIGRATION 016: SaaS Plans Foundation + Tenant Subscriptions
--
-- 1. Rebuilds billing_plans with complete per-feature limits
-- 2. Adds company_subscriptions — subscription lifecycle
-- 3. Adds plan_overrides — per-company limit customisation
-- 4. Adds get_company_limits() — single RPC to resolve effective limits
--
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. EXTEND billing_plans with full limit set
-- (The table already exists from migration 014;
--  we ALTER to add missing columns and re-seed with richer data.)
-- ============================================================

ALTER TABLE public.billing_plans
  ADD COLUMN IF NOT EXISTS monthly_price_usd   DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS annual_price_usd    DECIMAL(10,2) DEFAULT 0,
  -- Per-feature hard limits (NULL = unlimited)
  ADD COLUMN IF NOT EXISTS max_users           INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS max_customers       INTEGER DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS max_debts           INTEGER DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS daily_ai_actions    INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS daily_openai_calls  INTEGER DEFAULT 20,
  ADD COLUMN IF NOT EXISTS monthly_whatsapp    INTEGER DEFAULT 500,
  ADD COLUMN IF NOT EXISTS monthly_messages    INTEGER DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS max_campaigns       INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS monthly_imports     INTEGER DEFAULT 5,
  ADD COLUMN IF NOT EXISTS storage_gb          DECIMAL(6,2) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS voice_minutes_month INTEGER DEFAULT 0,
  -- Feature flags per plan
  ADD COLUMN IF NOT EXISTS feature_ai_scoring    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS feature_ai_actions    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS feature_whatsapp      BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_voice         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_campaigns     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_api_access    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_sso           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS feature_custom_rules  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order            INTEGER DEFAULT 0;

-- Re-seed plans with complete data
-- Use ON CONFLICT to update if already exists, insert if not
INSERT INTO public.billing_plans (
  name, display_name, billing_cycle,
  price_usd, monthly_price_usd, annual_price_usd,
  limits, features,
  max_users, max_customers, max_debts,
  daily_ai_actions, daily_openai_calls,
  monthly_whatsapp, monthly_messages,
  max_campaigns, monthly_imports, storage_gb, voice_minutes_month,
  feature_ai_scoring, feature_ai_actions, feature_whatsapp,
  feature_voice, feature_campaigns, feature_api_access,
  feature_sso, feature_custom_rules, sort_order, is_active
)
VALUES
(
  'starter', 'Starter', 'monthly',
  99, 99, 79,
  '{"max_debts":500,"max_collectors":2,"daily_ai_calls":20,"monthly_whatsapp":500,"voice_minutes":0}'::jsonb,
  '{"support":"email","sla":"48h"}'::jsonb,
  2, 500, 500,
  20, 10,
  500, 1000,
  0, 3, 1, 0,
  true, true, false,
  false, false, false,
  false, false, 1, true
),
(
  'business', 'Business', 'monthly',
  299, 299, 249,
  '{"max_debts":5000,"max_collectors":10,"daily_ai_calls":100,"monthly_whatsapp":2000,"voice_minutes":100}'::jsonb,
  '{"support":"priority","sla":"24h"}'::jsonb,
  10, 5000, 5000,
  100, 50,
  2000, 5000,
  5, 20, 10, 100,
  true, true, true,
  true, true, false,
  false, true, 2, true
),
(
  'enterprise', 'Enterprise', 'monthly',
  999, 999, 849,
  '{"max_debts":100000,"max_collectors":50,"daily_ai_calls":1000,"monthly_whatsapp":10000,"voice_minutes":1000}'::jsonb,
  '{"support":"dedicated","sla":"4h","account_manager":true}'::jsonb,
  50, 100000, 100000,
  1000, 500,
  10000, 25000,
  50, 200, 100, 1000,
  true, true, true,
  true, true, true,
  true, true, 3, true
),
(
  'growth', 'Growth', 'monthly',
  299, 299, 249,
  '{"max_debts":5000,"max_collectors":10,"daily_ai_calls":100,"monthly_whatsapp":2000,"voice_minutes":100}'::jsonb,
  '{"support":"priority","sla":"24h"}'::jsonb,
  10, 5000, 5000,
  100, 50,
  2000, 5000,
  5, 20, 10, 100,
  true, true, true,
  false, true, false,
  false, true, 2, true
)
ON CONFLICT (name) DO UPDATE SET
  display_name         = EXCLUDED.display_name,
  monthly_price_usd    = EXCLUDED.monthly_price_usd,
  annual_price_usd     = EXCLUDED.annual_price_usd,
  max_users            = EXCLUDED.max_users,
  max_customers        = EXCLUDED.max_customers,
  max_debts            = EXCLUDED.max_debts,
  daily_ai_actions     = EXCLUDED.daily_ai_actions,
  daily_openai_calls   = EXCLUDED.daily_openai_calls,
  monthly_whatsapp     = EXCLUDED.monthly_whatsapp,
  monthly_messages     = EXCLUDED.monthly_messages,
  max_campaigns        = EXCLUDED.max_campaigns,
  monthly_imports      = EXCLUDED.monthly_imports,
  storage_gb           = EXCLUDED.storage_gb,
  voice_minutes_month  = EXCLUDED.voice_minutes_month,
  feature_ai_scoring   = EXCLUDED.feature_ai_scoring,
  feature_ai_actions   = EXCLUDED.feature_ai_actions,
  feature_whatsapp     = EXCLUDED.feature_whatsapp,
  feature_voice        = EXCLUDED.feature_voice,
  feature_campaigns    = EXCLUDED.feature_campaigns,
  feature_api_access   = EXCLUDED.feature_api_access,
  feature_sso          = EXCLUDED.feature_sso,
  feature_custom_rules = EXCLUDED.feature_custom_rules,
  sort_order           = EXCLUDED.sort_order,
  is_active            = EXCLUDED.is_active;

-- ============================================================
-- 2. COMPANY SUBSCRIPTIONS — lifecycle tracking per tenant
-- ============================================================

CREATE TABLE IF NOT EXISTS public.company_subscriptions (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
  plan_name          TEXT NOT NULL DEFAULT 'starter'
                     REFERENCES public.billing_plans(name),
  status             TEXT NOT NULL DEFAULT 'trial'
                     CHECK (status IN ('trial','active','past_due','suspended','cancelled')),
  -- Dates
  trial_ends_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '14 days'),
  current_period_start TIMESTAMPTZ DEFAULT NOW(),
  current_period_end   TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  cancelled_at       TIMESTAMPTZ,
  -- Billing metadata (Stripe / other provider)
  external_customer_id   TEXT,   -- e.g. Stripe customer ID
  external_subscription_id TEXT, -- e.g. Stripe subscription ID
  billing_email      TEXT,
  billing_cycle      TEXT DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual')),
  mrr_usd            DECIMAL(10,2) DEFAULT 0,
  -- Internal notes
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.company_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='company_subscriptions' AND policyname='sub_select'
  ) THEN
    CREATE POLICY "sub_select" ON public.company_subscriptions
      FOR SELECT USING (company_id = public.get_user_company_id());
    -- Only service_role / admin can write
    CREATE POLICY "sub_admin_write" ON public.company_subscriptions
      FOR ALL USING (public.get_user_role() = 'admin')
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sub_company   ON public.company_subscriptions (company_id);
CREATE INDEX IF NOT EXISTS idx_sub_status    ON public.company_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_sub_trial_end ON public.company_subscriptions (trial_ends_at) WHERE status = 'trial';

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_company_subscriptions()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_company_subscriptions_trig ON public.company_subscriptions;
CREATE TRIGGER touch_company_subscriptions_trig
  BEFORE UPDATE ON public.company_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_company_subscriptions();

-- ============================================================
-- 3. PLAN OVERRIDES — per-company limit customisation
-- Allows sales to give specific companies higher limits than
-- their plan without upgrading them to the next tier.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.plan_overrides (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
  -- NULL means "use plan default", non-NULL overrides the plan value
  max_users           INTEGER,
  max_customers       INTEGER,
  max_debts           INTEGER,
  daily_ai_actions    INTEGER,
  daily_openai_calls  INTEGER,
  monthly_whatsapp    INTEGER,
  monthly_messages    INTEGER,
  max_campaigns       INTEGER,
  monthly_imports     INTEGER,
  storage_gb          DECIMAL(6,2),
  voice_minutes_month INTEGER,
  -- Feature overrides (NULL = use plan default)
  feature_ai_scoring    BOOLEAN,
  feature_ai_actions    BOOLEAN,
  feature_whatsapp      BOOLEAN,
  feature_voice         BOOLEAN,
  feature_campaigns     BOOLEAN,
  feature_api_access    BOOLEAN,
  feature_sso           BOOLEAN,
  feature_custom_rules  BOOLEAN,
  notes        TEXT,
  set_by       UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.plan_overrides ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename='plan_overrides' AND policyname='po_select'
  ) THEN
    CREATE POLICY "po_select" ON public.plan_overrides
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "po_admin_write" ON public.plan_overrides
      FOR ALL USING (public.get_user_role() = 'admin')
      WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- 4. get_company_limits() — resolves effective limits
-- Returns the merged limits for a company:
--   override column if not NULL, else plan column.
-- Called by usage-tracker and limit enforcement.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_company_limits(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_name TEXT;
  v_plan      public.billing_plans%ROWTYPE;
  v_override  public.plan_overrides%ROWTYPE;
  v_result    JSONB;
BEGIN
  -- Resolve plan name via subscription, fallback to companies.plan
  SELECT COALESCE(cs.plan_name, c.plan, 'starter')
  INTO v_plan_name
  FROM public.companies c
  LEFT JOIN public.company_subscriptions cs ON cs.company_id = c.id
  WHERE c.id = p_company_id;

  -- Fetch plan row
  SELECT * INTO v_plan FROM public.billing_plans WHERE name = v_plan_name;
  IF NOT FOUND THEN
    SELECT * INTO v_plan FROM public.billing_plans WHERE name = 'starter' LIMIT 1;
  END IF;

  -- Fetch override row (may not exist)
  SELECT * INTO v_override FROM public.plan_overrides WHERE company_id = p_company_id;

  -- Build result: override wins if non-NULL
  v_result := jsonb_build_object(
    'plan',                v_plan_name,
    'max_users',           COALESCE(v_override.max_users,           v_plan.max_users),
    'max_customers',       COALESCE(v_override.max_customers,       v_plan.max_customers),
    'max_debts',           COALESCE(v_override.max_debts,           v_plan.max_debts),
    'daily_ai_actions',    COALESCE(v_override.daily_ai_actions,    v_plan.daily_ai_actions),
    'daily_openai_calls',  COALESCE(v_override.daily_openai_calls,  v_plan.daily_openai_calls),
    'monthly_whatsapp',    COALESCE(v_override.monthly_whatsapp,    v_plan.monthly_whatsapp),
    'monthly_messages',    COALESCE(v_override.monthly_messages,    v_plan.monthly_messages),
    'max_campaigns',       COALESCE(v_override.max_campaigns,       v_plan.max_campaigns),
    'monthly_imports',     COALESCE(v_override.monthly_imports,     v_plan.monthly_imports),
    'storage_gb',          COALESCE(v_override.storage_gb,          v_plan.storage_gb),
    'voice_minutes_month', COALESCE(v_override.voice_minutes_month, v_plan.voice_minutes_month),
    'feature_ai_scoring',  COALESCE(v_override.feature_ai_scoring,  v_plan.feature_ai_scoring),
    'feature_ai_actions',  COALESCE(v_override.feature_ai_actions,  v_plan.feature_ai_actions),
    'feature_whatsapp',    COALESCE(v_override.feature_whatsapp,    v_plan.feature_whatsapp),
    'feature_voice',       COALESCE(v_override.feature_voice,       v_plan.feature_voice),
    'feature_campaigns',   COALESCE(v_override.feature_campaigns,   v_plan.feature_campaigns),
    'feature_api_access',  COALESCE(v_override.feature_api_access,  v_plan.feature_api_access),
    'feature_sso',         COALESCE(v_override.feature_sso,         v_plan.feature_sso),
    'feature_custom_rules',COALESCE(v_override.feature_custom_rules,v_plan.feature_custom_rules)
  );

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_limits(UUID) TO authenticated, service_role;

-- ============================================================
-- 5. Seed trial subscription for demo company
-- ============================================================

INSERT INTO public.company_subscriptions (company_id, plan_name, status, billing_email)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'growth', 'active', 'admin@aidebtos.com')
ON CONFLICT (company_id) DO NOTHING;

-- ============================================================
-- 6. Activate/Suspend helper functions (safe, no side-effects)
-- ============================================================

CREATE OR REPLACE FUNCTION public.activate_company(p_company_id UUID, p_actor_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.companies   SET is_active = true   WHERE id = p_company_id;
  UPDATE public.company_subscriptions
    SET status = 'active', cancelled_at = NULL
    WHERE company_id = p_company_id AND status IN ('suspended','cancelled');
  INSERT INTO public.logs (company_id, user_id, entity_type, entity_id, action, new_values)
  VALUES (p_company_id, p_actor_id, 'company', p_company_id, 'activated',
          jsonb_build_object('actor', p_actor_id, 'at', NOW()));
END;
$$;

CREATE OR REPLACE FUNCTION public.suspend_company(p_company_id UUID, p_actor_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.companies   SET is_active = false  WHERE id = p_company_id;
  UPDATE public.company_subscriptions
    SET status = 'suspended'
    WHERE company_id = p_company_id;
  INSERT INTO public.logs (company_id, user_id, entity_type, entity_id, action, new_values)
  VALUES (p_company_id, p_actor_id, 'company', p_company_id, 'suspended',
          jsonb_build_object('actor', p_actor_id, 'reason', p_reason, 'at', NOW()));
END;
$$;

GRANT EXECUTE ON FUNCTION public.activate_company(UUID, UUID)        TO service_role;
GRANT EXECUTE ON FUNCTION public.suspend_company(UUID, UUID, TEXT)   TO service_role;

COMMIT;
