-- ============================================================
-- MIGRATION 014: Advanced AI Collection Modules
-- All tables for modules 1-35. IDEMPOTENT.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SYSTEM CONFIG (Automation Mode + Module Toggles)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_config (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE UNIQUE,
  -- Automation mode: off | test | live
  automation_mode TEXT NOT NULL DEFAULT 'off'
                  CHECK (automation_mode IN ('off','test','live')),
  -- Per-module on/off toggles (JSONB for flexibility)
  modules      JSONB NOT NULL DEFAULT '{
    "smart_rules": true,
    "ai_memory": true,
    "behavior_profiles": true,
    "negotiation_engine": true,
    "voice_collector": false,
    "omnichannel_timeline": true,
    "campaign_engine": false,
    "approval_system": true,
    "promise_tracker": true,
    "knowledge_base": true,
    "human_handoff": true,
    "queue_priority": true
  }'::jsonb,
  -- Usage limits (Cost Shield)
  daily_ai_calls_limit      INTEGER DEFAULT 100,
  daily_whatsapp_limit      INTEGER DEFAULT 500,
  daily_call_analysis_limit INTEGER DEFAULT 50,
  monthly_cost_limit        DECIMAL(10,2) DEFAULT 100.00,
  -- Fallback behaviour when limit hit: rules | memory | manual
  limit_fallback TEXT DEFAULT 'rules'
                 CHECK (limit_fallback IN ('rules','memory','manual')),
  -- Emergency stop flags
  emergency_stop_all        BOOLEAN DEFAULT false,
  emergency_stop_ai         BOOLEAN DEFAULT false,
  emergency_stop_whatsapp   BOOLEAN DEFAULT false,
  emergency_stop_calls      BOOLEAN DEFAULT false,
  -- Voice collector settings
  voice_agent_name  TEXT DEFAULT 'AI Collector',
  voice_dialect     TEXT DEFAULT 'Saudi',
  call_hours_start  TIME DEFAULT '09:00',
  call_hours_end    TIME DEFAULT '18:00',
  daily_call_limit  INTEGER DEFAULT 50,
  -- AI usage priority order (lower = higher priority)
  ai_priority_rules    INTEGER DEFAULT 1,
  ai_priority_memory   INTEGER DEFAULT 2,
  ai_priority_cached   INTEGER DEFAULT 3,
  ai_priority_openai   INTEGER DEFAULT 4,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='system_config' AND policyname='syscfg_select') THEN
    CREATE POLICY "syscfg_select" ON public.system_config
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "syscfg_upsert" ON public.system_config
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin')
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

-- Seed default config for demo company
INSERT INTO public.system_config (company_id) VALUES ('aaaaaaaa-0000-4000-8000-000000000001')
ON CONFLICT (company_id) DO NOTHING;

-- ============================================================
-- 2. SMART RULES ENGINE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.collection_rules (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  -- Trigger condition (JSON DSL)
  condition    JSONB NOT NULL DEFAULT '{}',
  -- Action to take
  action       TEXT NOT NULL CHECK (action IN (
    'skip_ai','use_cached_reply','low_priority','high_priority',
    'human_handoff','auto_settle','escalate','do_nothing'
  )),
  action_params JSONB DEFAULT '{}',
  priority     INTEGER DEFAULT 50,   -- lower = runs first
  is_active    BOOLEAN DEFAULT true,
  -- Stats
  trigger_count INTEGER DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_by   UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.collection_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='collection_rules' AND policyname='rules_select') THEN
    CREATE POLICY "rules_select" ON public.collection_rules
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "rules_write" ON public.collection_rules
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rules_company_active ON public.collection_rules (company_id, priority) WHERE is_active = true;

-- Seed 5 example rules for demo company
INSERT INTO public.collection_rules (company_id, name, description, condition, action, priority)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','Customer Already Paid','Skip AI if debt is settled',
   '{"field":"debt.status","operator":"eq","value":"settled"}'::jsonb, 'skip_ai', 1),
  ('aaaaaaaa-0000-4000-8000-000000000001','Number Unreachable','No AI for closed/invalid numbers',
   '{"field":"last_contact_result","operator":"contains","value":"unreachable"}'::jsonb, 'skip_ai', 2),
  ('aaaaaaaa-0000-4000-8000-000000000001','Promise to Pay Received','Use cached reply for payment promises',
   '{"field":"last_message","operator":"contains_any","value":["بسدد","أرسل الإيصال","سوف أدفع"]}'::jsonb, 'use_cached_reply', 3),
  ('aaaaaaaa-0000-4000-8000-000000000001','No Response After 3 Attempts','Lower priority after repeated no-answer',
   '{"field":"contact_attempts","operator":"gte","value":3}'::jsonb, 'low_priority', 10),
  ('aaaaaaaa-0000-4000-8000-000000000001','High Value Debt','Escalate debts over 100k',
   '{"field":"debt.current_balance","operator":"gt","value":100000}'::jsonb, 'high_priority', 5)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. AI MEMORY / RESPONSE LEARNING
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ai_memory (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  trigger_pattern TEXT NOT NULL,          -- message pattern that triggers this
  trigger_type    TEXT DEFAULT 'keyword'  -- keyword | regex | semantic
                  CHECK (trigger_type IN ('keyword','regex','semantic')),
  response_text   TEXT NOT NULL,
  language        TEXT DEFAULT 'ar'
                  CHECK (language IN ('ar','en','both')),
  category        TEXT DEFAULT 'general'  -- payment_promise | objection | angry | general
                  CHECK (category IN ('payment_promise','objection','angry','greeting','escalation','general')),
  -- Learning metrics
  success_count   INTEGER DEFAULT 0,
  failure_count   INTEGER DEFAULT 0,
  use_count       INTEGER DEFAULT 0,
  success_rate    DECIMAL(5,2) DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  -- Review system
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','auto_approved')),
  reviewed_by     UUID REFERENCES public.profiles(id),
  reviewed_at     TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT false,  -- only active after approval
  source          TEXT DEFAULT 'manual'
                  CHECK (source IN ('manual','ai_learned','imported')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.ai_memory ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ai_memory' AND policyname='memory_select') THEN
    CREATE POLICY "memory_select" ON public.ai_memory
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "memory_write" ON public.ai_memory
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memory_company_active ON public.ai_memory (company_id, category) WHERE is_active = true AND status = 'approved';

INSERT INTO public.ai_memory (company_id, trigger_pattern, response_text, category, status, is_active, source, success_count, use_count)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','بسدد','شكراً لتأكيد رغبتك في السداد. يرجى إرسال الإيصال بعد الدفع.','payment_promise','approved',true,'manual',45,52),
  ('aaaaaaaa-0000-4000-8000-000000000001','مو عندي فلوس','نفهم ظروفك. يمكننا ترتيب خطة سداد مريحة. هل تودّ التحدث مع أحد مستشارينا؟','objection','approved',true,'manual',28,35),
  ('aaaaaaaa-0000-4000-8000-000000000001','مش مهتم','نحترم وجهة نظرك. قد يؤثر التأخر على سجلك الائتماني. يسعدنا مساعدتك في إيجاد حل.','objection','approved',true,'manual',15,20)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. CUSTOMER BEHAVIOR PROFILES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.customer_behavior (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  -- Behavior classification
  behavior_type    TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (behavior_type IN (
                     'cooperative','procrastinator','refusing',
                     'angry','evasive','negotiable','unknown'
                   )),
  behavior_score   INTEGER DEFAULT 50 CHECK (behavior_score BETWEEN 0 AND 100),
  risk_level       TEXT DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  -- Contact stats
  total_contacts   INTEGER DEFAULT 0,
  successful_contacts INTEGER DEFAULT 0,
  no_answer_count  INTEGER DEFAULT 0,
  promises_made    INTEGER DEFAULT 0,
  promises_kept    INTEGER DEFAULT 0,
  -- AI analysis
  ai_notes         TEXT,
  ai_confidence    DECIMAL(5,2) DEFAULT 0,
  last_analyzed_at TIMESTAMPTZ,
  -- Negotiation preferences
  preferred_channel TEXT DEFAULT 'whatsapp' CHECK (preferred_channel IN ('whatsapp','call','email','sms')),
  best_contact_time TEXT,
  negotiation_style TEXT DEFAULT 'standard' CHECK (negotiation_style IN ('firm','soft','standard','settlement')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, customer_id)
);

ALTER TABLE public.customer_behavior ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_behavior' AND policyname='behavior_select') THEN
    CREATE POLICY "behavior_select" ON public.customer_behavior
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "behavior_write" ON public.customer_behavior
      FOR ALL USING (company_id = public.get_user_company_id())
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_behavior_customer ON public.customer_behavior (company_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_behavior_type ON public.customer_behavior (company_id, behavior_type, risk_level);

-- ============================================================
-- 5. NEGOTIATION SCENARIOS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.negotiation_scenarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  behavior_type TEXT NOT NULL CHECK (behavior_type IN (
                  'cooperative','procrastinator','refusing','angry','evasive','negotiable','all'
                )),
  style         TEXT NOT NULL CHECK (style IN ('firm','soft','standard','settlement','escalation')),
  steps         JSONB NOT NULL DEFAULT '[]',  -- ordered conversation steps
  success_rate  DECIMAL(5,2) DEFAULT 0,
  use_count     INTEGER DEFAULT 0,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.negotiation_scenarios ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='negotiation_scenarios' AND policyname='neg_select') THEN
    CREATE POLICY "neg_select" ON public.negotiation_scenarios
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "neg_write" ON public.negotiation_scenarios
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

INSERT INTO public.negotiation_scenarios (company_id, name, behavior_type, style, steps)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','Firm Follow-up','procrastinator','firm',
   '[{"step":1,"message":"نذكّرك بضرورة السداد لتجنب التأثير على سجلك الائتماني."},{"step":2,"message":"آخر مهلة للسداد قبل التصعيد القانوني."}]'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000001','De-escalation','angry','soft',
   '[{"step":1,"message":"نقدّر تواصلك ونحن هنا لمساعدتك في إيجاد حل مناسب."},{"step":2,"message":"يمكننا تقسيم المبلغ على دفعات مريحة."}]'::jsonb),
  ('aaaaaaaa-0000-4000-8000-000000000001','Settlement Offer','negotiable','settlement',
   '[{"step":1,"message":"لديك فرصة الحصول على تسوية استثنائية بخصم يصل إلى 20%."},{"step":2,"message":"العرض محدود الوقت، تواصل معنا اليوم."}]'::jsonb)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 6. VOICE COLLECTOR SESSIONS (placeholder for future Tameez/Twilio)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.voice_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id      UUID REFERENCES public.customers(id),
  debt_id          UUID REFERENCES public.debts(id),
  -- Session meta
  session_type     TEXT DEFAULT 'ai_call' CHECK (session_type IN ('ai_call','human_call','simulation')),
  status           TEXT DEFAULT 'planned' CHECK (status IN ('planned','dialing','in_progress','completed','failed','no_answer')),
  -- Outcome
  outcome          TEXT CHECK (outcome IN ('promise_to_pay','payment_received','refused','no_answer','callback_requested','escalated','other')),
  promise_amount   DECIMAL(15,2),
  promise_date     DATE,
  duration_seconds INTEGER DEFAULT 0,
  -- AI stats
  ai_confidence    DECIMAL(5,2),
  sentiment        TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  transcript       TEXT,
  -- Cost
  cost_usd         DECIMAL(10,6) DEFAULT 0,
  provider         TEXT DEFAULT 'tameez' CHECK (provider IN ('tameez','twilio','custom','simulation')),
  provider_session_id TEXT,
  scheduled_at     TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='voice_sessions' AND policyname='voice_select') THEN
    CREATE POLICY "voice_select" ON public.voice_sessions
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "voice_write" ON public.voice_sessions
      FOR ALL USING (company_id = public.get_user_company_id())
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_voice_company_date ON public.voice_sessions (company_id, created_at DESC);

-- ============================================================
-- 7. CUSTOMER TIMELINE EVENTS (Omnichannel)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.timeline_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id      UUID REFERENCES public.debts(id),
  event_type   TEXT NOT NULL CHECK (event_type IN (
                 'whatsapp_in','whatsapp_out','call_in','call_out',
                 'ai_reply','collector_note','promise_to_pay',
                 'payment','status_change','ai_analysis','rule_triggered',
                 'campaign','human_handoff','escalation'
               )),
  channel      TEXT CHECK (channel IN ('whatsapp','call','email','sms','system','ai','manual')),
  summary      TEXT NOT NULL,
  detail       TEXT,
  amount       DECIMAL(15,2),
  actor_type   TEXT DEFAULT 'system' CHECK (actor_type IN ('ai','collector','customer','system','campaign')),
  actor_id     UUID,                 -- collector profile id or null
  actor_name   TEXT,
  ai_used      BOOLEAN DEFAULT false,
  cost_usd     DECIMAL(10,6) DEFAULT 0,
  metadata     JSONB DEFAULT '{}',
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.timeline_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='timeline_events' AND policyname='timeline_select') THEN
    CREATE POLICY "timeline_select" ON public.timeline_events
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "timeline_write" ON public.timeline_events
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_timeline_customer ON public.timeline_events (company_id, customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_type ON public.timeline_events (company_id, event_type, occurred_at DESC);

-- ============================================================
-- 8. CAMPAIGNS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.campaigns (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  campaign_type  TEXT NOT NULL CHECK (campaign_type IN (
                   'overdue_90','pre_salary','post_holiday',
                   'settlement','reminder','custom'
                 )),
  status         TEXT DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled')),
  channels       JSONB DEFAULT '["whatsapp"]',  -- ["whatsapp","call","email"]
  target_filter  JSONB DEFAULT '{}',            -- filter criteria for customers
  message_template TEXT,
  scheduled_at   TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  -- Stats
  target_count   INTEGER DEFAULT 0,
  sent_count     INTEGER DEFAULT 0,
  delivered_count INTEGER DEFAULT 0,
  response_count INTEGER DEFAULT 0,
  payment_count  INTEGER DEFAULT 0,
  total_collected DECIMAL(15,2) DEFAULT 0,
  cost_usd       DECIMAL(10,6) DEFAULT 0,
  created_by     UUID REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='campaigns' AND policyname='campaigns_select') THEN
    CREATE POLICY "campaigns_select" ON public.campaigns
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "campaigns_write" ON public.campaigns
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaigns_company ON public.campaigns (company_id, status, created_at DESC);

-- ============================================================
-- 9. APPROVAL QUEUE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.approvals (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  approval_type   TEXT NOT NULL CHECK (approval_type IN (
                    'large_settlement','discount','legal_escalation',
                    'stop_followup','write_off','ai_learning','campaign_launch','custom'
                  )),
  title           TEXT NOT NULL,
  description     TEXT,
  entity_type     TEXT,   -- debt | customer | campaign | ai_memory
  entity_id       UUID,
  requested_data  JSONB DEFAULT '{}',
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  priority        TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  requested_by    UUID REFERENCES public.profiles(id),
  reviewed_by     UUID REFERENCES public.profiles(id),
  review_notes    TEXT,
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '48 hours'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='approvals' AND policyname='approvals_select') THEN
    CREATE POLICY "approvals_select" ON public.approvals
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "approvals_write" ON public.approvals
      FOR ALL USING (company_id = public.get_user_company_id())
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_approvals_pending ON public.approvals (company_id, status, created_at DESC) WHERE status = 'pending';

-- ============================================================
-- 10. PROMISE-TO-PAY TRACKER
-- ============================================================

CREATE TABLE IF NOT EXISTS public.promises (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES public.customers(id),
  debt_id         UUID NOT NULL REFERENCES public.debts(id),
  promised_amount DECIMAL(15,2) NOT NULL,
  promised_date   DATE NOT NULL,
  channel         TEXT DEFAULT 'whatsapp',
  status          TEXT DEFAULT 'pending' CHECK (status IN ('pending','kept','broken','rescheduled','partial')),
  collector_id    UUID REFERENCES public.profiles(id),
  notes           TEXT,
  follow_up_at    TIMESTAMPTZ,
  fulfilled_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.promises ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='promises' AND policyname='promises_select') THEN
    CREATE POLICY "promises_select" ON public.promises
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "promises_write" ON public.promises
      FOR ALL USING (company_id = public.get_user_company_id())
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_promises_pending ON public.promises (company_id, status, promised_date) WHERE status = 'pending';

-- ============================================================
-- 11. KNOWLEDGE BASE / POLICY ENGINE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.knowledge_base (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  category     TEXT DEFAULT 'policy' CHECK (category IN (
                 'policy','rule','script','faq','forbidden','escalation_criteria','other'
               )),
  language     TEXT DEFAULT 'ar' CHECK (language IN ('ar','en','both')),
  tags         TEXT[],
  is_active    BOOLEAN DEFAULT true,
  created_by   UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='knowledge_base' AND policyname='kb_select') THEN
    CREATE POLICY "kb_select" ON public.knowledge_base
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "kb_write" ON public.knowledge_base
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

-- ============================================================
-- 12. SAAS / BILLING PREP (tenants + billing)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.billing_plans (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         TEXT NOT NULL UNIQUE,    -- starter | growth | enterprise
  display_name TEXT NOT NULL,
  price_usd    DECIMAL(10,2) DEFAULT 0,
  billing_cycle TEXT DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','annual')),
  limits        JSONB NOT NULL DEFAULT '{
    "max_debts": 1000,
    "max_collectors": 5,
    "daily_ai_calls": 50,
    "monthly_whatsapp": 1000,
    "voice_minutes": 0
  }'::jsonb,
  features      JSONB DEFAULT '{}',
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.billing_plans (name, display_name, price_usd, limits) VALUES
  ('starter',    'Starter',    99,   '{"max_debts":500,"max_collectors":2,"daily_ai_calls":20,"monthly_whatsapp":500,"voice_minutes":0}'::jsonb),
  ('growth',     'Growth',     299,  '{"max_debts":5000,"max_collectors":10,"daily_ai_calls":100,"monthly_whatsapp":2000,"voice_minutes":100}'::jsonb),
  ('enterprise', 'Enterprise', 999,  '{"max_debts":100000,"max_collectors":50,"daily_ai_calls":1000,"monthly_whatsapp":10000,"voice_minutes":1000}'::jsonb)
ON CONFLICT (name) DO NOTHING;

-- Tenant usage tracking
CREATE TABLE IF NOT EXISTS public.tenant_usage (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  period         TEXT NOT NULL,  -- YYYY-MM
  debts_count    INTEGER DEFAULT 0,
  collectors_count INTEGER DEFAULT 0,
  ai_calls_used  INTEGER DEFAULT 0,
  whatsapp_sent  INTEGER DEFAULT 0,
  voice_minutes  DECIMAL(8,2) DEFAULT 0,
  total_cost_usd DECIMAL(10,4) DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, period)
);

ALTER TABLE public.tenant_usage ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_usage' AND policyname='usage_select') THEN
    CREATE POLICY "usage_select" ON public.tenant_usage
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "usage_write" ON public.tenant_usage
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Infrastructure cost tracking
CREATE TABLE IF NOT EXISTS public.infra_costs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES public.companies(id),  -- null = platform-wide
  service     TEXT NOT NULL CHECK (service IN ('vercel','supabase','storage','monitoring','domain','other')),
  amount_usd  DECIMAL(10,4) NOT NULL,
  period      TEXT NOT NULL,  -- YYYY-MM
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service, period, company_id)
);

-- ============================================================
-- 13. SYSTEM MONITORING / ALERTS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.system_alerts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID REFERENCES public.companies(id),
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','error','critical')),
  alert_type   TEXT NOT NULL,  -- api_failure | queue_overload | high_cost | limit_reached | ...
  title        TEXT NOT NULL,
  message      TEXT,
  metadata     JSONB DEFAULT '{}',
  is_read      BOOLEAN DEFAULT false,
  is_resolved  BOOLEAN DEFAULT false,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='system_alerts' AND policyname='alerts_select') THEN
    CREATE POLICY "alerts_select" ON public.system_alerts
      FOR SELECT USING (company_id = public.get_user_company_id() OR company_id IS NULL);
    CREATE POLICY "alerts_write" ON public.system_alerts
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_alerts_company ON public.system_alerts (company_id, is_read, created_at DESC);

-- ============================================================
-- 14. COLLECTION ATTRIBUTION
-- ============================================================

CREATE TABLE IF NOT EXISTS public.collection_attribution (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  payment_id         UUID REFERENCES public.payments(id),
  customer_id        UUID REFERENCES public.customers(id),
  debt_id            UUID REFERENCES public.debts(id),
  portfolio_id       UUID REFERENCES public.portfolios(id),
  amount             DECIMAL(15,2) NOT NULL,
  -- Attribution
  primary_channel    TEXT CHECK (primary_channel IN ('whatsapp','call','ai_reply','collector','campaign','self_service','unknown')),
  primary_actor      TEXT CHECK (primary_actor IN ('ai','collector','ai_assisted','campaign','customer','unknown')),
  campaign_id        UUID REFERENCES public.campaigns(id),
  collector_id       UUID REFERENCES public.profiles(id),
  voice_session_id   UUID REFERENCES public.voice_sessions(id),
  ai_assisted        BOOLEAN DEFAULT false,
  rule_used          BOOLEAN DEFAULT false,
  memory_used        BOOLEAN DEFAULT false,
  touches_before_pay INTEGER DEFAULT 1,
  days_to_collect    INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.collection_attribution ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='collection_attribution' AND policyname='attr_select') THEN
    CREATE POLICY "attr_select" ON public.collection_attribution
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "attr_write" ON public.collection_attribution
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attr_company ON public.collection_attribution (company_id, created_at DESC);

-- ============================================================
-- 15. MODULE FEATURE FLAGS (Progressive Rollout)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES public.companies(id),  -- null = global
  feature_key TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'disabled'
              CHECK (status IN ('disabled','internal_test','limited','production')),
  rollout_pct INTEGER DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  notes       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, feature_key)
);

-- Seed default feature flags
INSERT INTO public.feature_flags (feature_key, status, rollout_pct, notes) VALUES
  ('smart_rules_engine',   'production',  100, 'Core rules, fully stable'),
  ('ai_memory',            'production',  100, 'Response library'),
  ('behavior_profiles',    'limited',      50, 'Customer classification'),
  ('negotiation_engine',   'limited',      50, 'Scenario-based negotiation'),
  ('voice_collector',      'internal_test', 0, 'Awaiting Tameez integration'),
  ('campaign_engine',      'internal_test', 0, 'Awaiting LIVE mode activation'),
  ('saas_billing',         'disabled',      0, 'Future multi-tenant billing'),
  ('ai_simulation',        'internal_test', 0, 'Training mode'),
  ('collection_attribution','limited',     50, 'Payment attribution tracking')
ON CONFLICT (company_id, feature_key) DO NOTHING;

-- Auto-update updated_at for system_config
CREATE OR REPLACE FUNCTION public.touch_system_config()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS touch_system_config_trigger ON public.system_config;
CREATE TRIGGER touch_system_config_trigger
  BEFORE UPDATE ON public.system_config FOR EACH ROW EXECUTE FUNCTION public.touch_system_config();

COMMIT;
