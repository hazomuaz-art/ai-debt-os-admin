-- ============================================================
-- MIGRATION 013: Portfolios / Projects / Cost Center
--
-- Adds:
--   1. portfolios       — الشركات/المشاريع (Mobily, STC, Aseeg, ...)
--   2. debt_portfolios  — ربط الدين بالمحفظة
--   3. debit_collect_sync — سجل مزامنة من Debit Collect / Tamiuzz
--   4. ai_cost_log      — تسجيل تكلفة كل عملية AI / API
--   5. cost_settings    — إعدادات أسعار التكلفة
--
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. PORTFOLIOS (الشركات / المشاريع / المحافظ)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.portfolios (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,                 -- e.g. "Mobily", "STC"
  name_ar      TEXT,                          -- الاسم بالعربي
  code         TEXT,                          -- رمز قصير: MOB, STC, ASG ...
  category     TEXT NOT NULL DEFAULT 'telecom'
               CHECK (category IN (
                 'telecom','insurance','utility','recruitment',
                 'government','finance','agriculture','other'
               )),
  -- Debit Collect / Tamiuzz identifiers
  external_id  TEXT,                          -- ID في نظام Debit Collect
  source_system TEXT DEFAULT 'manual'
               CHECK (source_system IN ('manual','debit_collect','tamiuzz','api')),
  color        TEXT DEFAULT '#6272f1',        -- hex for UI badges
  is_active    BOOLEAN NOT NULL DEFAULT true,
  notes        TEXT,
  metadata     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

ALTER TABLE public.portfolios ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portfolios' AND policyname='portfolios_select') THEN
    CREATE POLICY "portfolios_select" ON public.portfolios
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "portfolios_insert" ON public.portfolios
      FOR INSERT WITH CHECK (
        company_id = public.get_user_company_id()
        AND public.get_user_role() IN ('admin','manager')
      );
    CREATE POLICY "portfolios_update" ON public.portfolios
      FOR UPDATE USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
    CREATE POLICY "portfolios_delete" ON public.portfolios
      FOR DELETE USING (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_portfolios_company ON public.portfolios (company_id, is_active);

-- ============================================================
-- 2. DEBT ↔ PORTFOLIO link (many-to-one: debt belongs to 1 portfolio)
-- ============================================================

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES public.portfolios(id),
  ADD COLUMN IF NOT EXISTS external_ref  TEXT,     -- reference in Debit Collect
  ADD COLUMN IF NOT EXISTS collector_name TEXT,    -- from Debit Collect raw sync
  ADD COLUMN IF NOT EXISTS last_contact_result TEXT, -- last outcome from sync
  ADD COLUMN IF NOT EXISTS last_contact_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_debts_portfolio ON public.debts (portfolio_id) WHERE portfolio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_debts_external_ref ON public.debts (company_id, external_ref) WHERE external_ref IS NOT NULL;

-- ============================================================
-- 3. DEBIT COLLECT / TAMIUZZ SYNC LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS public.debit_collect_sync (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_system       TEXT NOT NULL DEFAULT 'debit_collect'
                      CHECK (source_system IN ('debit_collect','tamiuzz','manual')),
  sync_type           TEXT NOT NULL DEFAULT 'full'
                      CHECK (sync_type IN ('full','incremental','single')),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','completed','failed','partial')),
  -- Raw data from external system
  external_customer_id   TEXT,
  external_debt_id       TEXT,
  portfolio_name         TEXT,
  portfolio_code         TEXT,
  customer_name          TEXT,
  customer_phone         TEXT,
  customer_national_id   TEXT,
  debt_amount            DECIMAL(15,2),
  remaining_amount       DECIMAL(15,2),
  payment_status         TEXT,
  contact_status         TEXT,
  collector_name         TEXT,
  last_contact_result    TEXT,
  last_contact_date      DATE,
  notes                  TEXT,
  -- Mapping result
  mapped_customer_id  UUID REFERENCES public.customers(id),
  mapped_debt_id      UUID REFERENCES public.debts(id),
  mapped_portfolio_id UUID REFERENCES public.portfolios(id),
  -- Meta
  records_total       INTEGER DEFAULT 0,
  records_processed   INTEGER DEFAULT 0,
  records_failed      INTEGER DEFAULT 0,
  error_log           JSONB DEFAULT '[]',
  raw_payload         JSONB DEFAULT '{}',
  synced_by           UUID REFERENCES public.profiles(id),
  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.debit_collect_sync ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='debit_collect_sync' AND policyname='sync_select') THEN
    CREATE POLICY "sync_select" ON public.debit_collect_sync
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "sync_insert" ON public.debit_collect_sync
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id());
    CREATE POLICY "sync_update" ON public.debit_collect_sync
      FOR UPDATE USING (company_id = public.get_user_company_id())
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_dc_sync_company ON public.debit_collect_sync (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_sync_external ON public.debit_collect_sync (company_id, external_debt_id) WHERE external_debt_id IS NOT NULL;

-- ============================================================
-- 4. AI COST LOG (تسجيل تكلفة كل عملية AI / API)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_cost_log (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL DEFAULT 'openai'
                       CHECK (provider IN ('openai','whatsapp','tameez','rasf','storage','external','other')),
  model                TEXT,                     -- gpt-4o-mini, gpt-4o, ...
  action_type          TEXT NOT NULL,             -- score_debt, generate_actions, send_whatsapp, ...
  input_tokens         INTEGER DEFAULT 0,
  output_tokens        INTEGER DEFAULT 0,
  total_tokens         INTEGER DEFAULT 0,
  estimated_cost       DECIMAL(10,6) DEFAULT 0,  -- USD
  -- Context
  portfolio_id         UUID REFERENCES public.portfolios(id),
  portfolio_name       TEXT,
  customer_id          UUID REFERENCES public.customers(id),
  customer_reference   TEXT,
  debt_id              UUID REFERENCES public.debts(id),
  collector_id         UUID REFERENCES public.profiles(id),
  collector_name       TEXT,
  -- Meta
  duration_ms          INTEGER,
  success              BOOLEAN DEFAULT true,
  error_message        TEXT,
  metadata             JSONB DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_cost_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_cost_log' AND policyname='cost_log_select') THEN
    CREATE POLICY "cost_log_select" ON public.ai_cost_log
      FOR SELECT USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'));
    CREATE POLICY "cost_log_insert" ON public.ai_cost_log
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cost_log_company_date   ON public.ai_cost_log (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_log_provider       ON public.ai_cost_log (company_id, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_log_action         ON public.ai_cost_log (company_id, action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cost_log_portfolio      ON public.ai_cost_log (company_id, portfolio_id, created_at DESC) WHERE portfolio_id IS NOT NULL;

-- ============================================================
-- 5. COST SETTINGS (إعدادات أسعار التكلفة)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cost_settings (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id              UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
  -- OpenAI pricing (per 1M tokens, USD)
  openai_input_per_1m     DECIMAL(8,4) DEFAULT 0.15,   -- gpt-4o-mini input
  openai_output_per_1m    DECIMAL(8,4) DEFAULT 0.60,   -- gpt-4o-mini output
  -- WhatsApp pricing (per message, USD)
  whatsapp_outbound       DECIMAL(8,6) DEFAULT 0.0500,
  whatsapp_inbound        DECIMAL(8,6) DEFAULT 0.0050,
  -- Call analysis pricing (per minute, USD)
  call_analysis_per_min   DECIMAL(8,6) DEFAULT 0.0240,
  -- Storage pricing (per GB/month, USD)
  storage_per_gb          DECIMAL(8,4) DEFAULT 0.0230,
  -- External API flat rate (per call, USD)
  external_api_per_call   DECIMAL(8,6) DEFAULT 0.0010,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.cost_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='cost_settings' AND policyname='cost_settings_select') THEN
    CREATE POLICY "cost_settings_select" ON public.cost_settings
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "cost_settings_upsert" ON public.cost_settings
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin')
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

-- ============================================================
-- 6. SEED the 11 default portfolios for demo company
-- ============================================================

INSERT INTO public.portfolios (id, company_id, name, name_ar, code, category, color)
VALUES
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Mobily',               'موبايلي',                    'MOB', 'telecom',     '#7C3AED'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','STC',                  'الاتصالات السعودية',          'STC', 'telecom',     '#2563EB'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Aseeg',                'أسيج',                       'ASG', 'finance',     '#D97706'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Al-Taawuniya (3rd)',   'التعاونية - طرف ثالث',        'TAW3','insurance',   '#059669'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Al-Taawuniya (Regress)','التعاونية - حق رجوع',        'TAWR','insurance',   '#0D9488'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Elm - Done',           'علم - تم',                   'ELM', 'government',  '#6366F1'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','National Water Co.',   'شركة المياه الوطنية',         'NWC', 'utility',     '#0EA5E9'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Electricity',          'شركة الكهرباء',               'ELEC','utility',     '#F59E0B'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Midgulf',              'ميدغلف',                     'MID', 'finance',     '#EC4899'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Mahara Recruitment',   'مهارة للاستقدام',             'MAH', 'recruitment', '#8B5CF6'),
  (uuid_generate_v4(),'aaaaaaaa-0000-4000-8000-000000000001','Kahel Agriculture',    'كاهل الزراعية',               'KAH', 'agriculture', '#16A34A')
ON CONFLICT (company_id, code) DO NOTHING;

-- ============================================================
-- 7. DEFAULT cost settings for demo company
-- ============================================================

INSERT INTO public.cost_settings (company_id)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001')
ON CONFLICT (company_id) DO NOTHING;

-- ============================================================
-- 8. AUTO touch updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_portfolios()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_portfolios_trigger ON public.portfolios;
CREATE TRIGGER touch_portfolios_trigger
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW EXECUTE FUNCTION public.touch_portfolios();

COMMIT;
