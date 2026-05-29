-- ============================================================
-- MIGRATION 015: Smart Response Engine + Usage Tracking
--
-- Smart Response Engine:
--   1. response_templates  — hand-crafted reply templates
--   2. response_cache      — recently-used AI responses
--   3. intent_patterns     — incoming-message intent matchers
--
-- Usage Tracking (extends tenant_usage):
--   4. Adds missing columns to tenant_usage
--   5. usage_events        — granular event log for every tracked action
--
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. RESPONSE TEMPLATES
-- Hand-crafted, admin-managed reply templates.
-- Checked BEFORE ai_memory and BEFORE OpenAI.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.response_templates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  trigger_keywords TEXT[] NOT NULL DEFAULT '{}',  -- keywords that activate this template
  intent_category  TEXT NOT NULL DEFAULT 'general'
                   CHECK (intent_category IN (
                     'payment_promise','payment_received','objection_money',
                     'objection_dispute','angry','greeting','escalation',
                     'number_busy','no_answer','wrong_number','general'
                   )),
  response_ar     TEXT,                   -- Arabic response text
  response_en     TEXT,                   -- English response text
  channel         TEXT DEFAULT 'all'
                  CHECK (channel IN ('whatsapp','call','email','sms','all')),
  min_confidence  DECIMAL(4,2) DEFAULT 0.70, -- minimum match score to use this
  is_active       BOOLEAN DEFAULT true,
  priority        INTEGER DEFAULT 50,     -- lower = checked first
  use_count       INTEGER DEFAULT 0,
  success_count   INTEGER DEFAULT 0,
  created_by      UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.response_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'response_templates' AND policyname = 'rt_select'
  ) THEN
    CREATE POLICY "rt_select" ON public.response_templates
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "rt_write" ON public.response_templates
      FOR ALL
      USING (company_id = public.get_user_company_id()
             AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rt_company_active
  ON public.response_templates (company_id, priority)
  WHERE is_active = true;

-- Seed 5 default templates for the demo company
INSERT INTO public.response_templates
  (company_id, name, trigger_keywords, intent_category, response_ar, response_en, priority)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'Payment Promise',
   ARRAY['بسدد','سوف أدفع','هسدد','بكره أسدد','هذا الاسبوع','نهاية الشهر'],
   'payment_promise',
   'شكراً لتأكيدك. سنتابع معك في الموعد المحدد. يرجى إرسال إيصال الدفع بمجرد السداد.',
   'Thank you for your confirmation. We will follow up on the agreed date. Please send the payment receipt once settled.',
   1),
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'No Money Objection',
   ARRAY['مو عندي','ما عندي فلوس','ما عندي مال','ضائق','ظروف','مشكلة مالية'],
   'objection_money',
   'نتفهم وضعك. هل يمكننا ترتيب خطة سداد مريحة؟ تواصل معنا لنجد حلاً مناسباً.',
   'We understand your situation. Can we arrange a comfortable payment plan? Contact us to find a suitable solution.',
   2),
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'Number Busy / No Answer',
   ARRAY['مشغول','لا يرد','الرقم مغلق','اتصل لاحقاً'],
   'no_answer',
   '',
   '',
   3),
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'Angry Customer',
   ARRAY['محكمة','مشكلة','هددني','بشتكي','ما لكم حق','أبلغ'],
   'angry',
   'نقدّر تواصلك ونأخذ ملاحظاتك بجدية. سيتواصل معك مشرفنا خلال 24 ساعة.',
   'We appreciate your feedback and take it seriously. Our supervisor will contact you within 24 hours.',
   4),
  ('aaaaaaaa-0000-4000-8000-000000000001',
   'Wrong Number',
   ARRAY['رقم خطأ','مو أنا','غلط','مو صاحب الدين','شخص ثاني'],
   'objection_dispute',
   'عذراً على الإزعاج. سنراجع بياناتنا ونعود إليك إذا احتجنا تأكيداً.',
   'Sorry for the inconvenience. We will review our records and contact you if we need confirmation.',
   5)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 2. RESPONSE CACHE
-- Stores recent AI-generated responses to avoid repeating
-- identical OpenAI calls for similar incoming messages.
-- Cache key = normalized hash of (company_id + message_hash).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.response_cache (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  message_hash    TEXT NOT NULL,      -- SHA-256 of normalized input text
  input_text      TEXT NOT NULL,      -- original input (for debugging)
  response_text   TEXT NOT NULL,      -- cached response
  intent_category TEXT,
  language        TEXT DEFAULT 'ar',
  model_used      TEXT,               -- which model generated this
  confidence      DECIMAL(4,2),
  hit_count       INTEGER DEFAULT 0,  -- times this cache entry was served
  last_hit_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, message_hash)
);

ALTER TABLE public.response_cache ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'response_cache' AND policyname = 'rc_select'
  ) THEN
    CREATE POLICY "rc_select" ON public.response_cache
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "rc_write" ON public.response_cache
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rc_lookup
  ON public.response_cache (company_id, message_hash)
  WHERE expires_at > NOW();

-- Clean up expired cache entries (called by job worker)
CREATE OR REPLACE FUNCTION public.cleanup_response_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM public.response_cache WHERE expires_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_response_cache() TO service_role;

-- ============================================================
-- 3. INTENT PATTERNS
-- Regex / keyword patterns that classify incoming messages
-- into intents before touching AI.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.intent_patterns (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  intent          TEXT NOT NULL
                  CHECK (intent IN (
                    'payment_promise','payment_received','objection_money',
                    'objection_dispute','angry','greeting','escalation',
                    'no_answer','wrong_number','request_info','general'
                  )),
  pattern_type    TEXT NOT NULL DEFAULT 'keyword'
                  CHECK (pattern_type IN ('keyword','phrase','regex')),
  pattern_value   TEXT NOT NULL,
  language        TEXT DEFAULT 'ar',
  weight          INTEGER DEFAULT 1,  -- higher = stronger signal
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.intent_patterns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'intent_patterns' AND policyname = 'ip_select'
  ) THEN
    CREATE POLICY "ip_select" ON public.intent_patterns
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "ip_write" ON public.intent_patterns
      FOR ALL
      USING (company_id = public.get_user_company_id()
             AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ip_company_intent
  ON public.intent_patterns (company_id, intent, is_active);

-- Seed default intent patterns for demo company
INSERT INTO public.intent_patterns
  (company_id, intent, pattern_type, pattern_value, language, weight)
VALUES
  -- Payment promises (AR)
  ('aaaaaaaa-0000-4000-8000-000000000001', 'payment_promise', 'keyword', 'بسدد', 'ar', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'payment_promise', 'keyword', 'سوف أدفع', 'ar', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'payment_promise', 'keyword', 'هسدد', 'ar', 4),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'payment_promise', 'keyword', 'نهاية الشهر', 'ar', 3),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'payment_promise', 'keyword', 'أرسل الإيصال', 'ar', 5),
  -- Payment received
  ('aaaaaaaa-0000-4000-8000-000000000001', 'payment_received', 'keyword', 'دفعت', 'ar', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'payment_received', 'keyword', 'تم السداد', 'ar', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'payment_received', 'keyword', 'سددت', 'ar', 5),
  -- Money objections
  ('aaaaaaaa-0000-4000-8000-000000000001', 'objection_money', 'keyword', 'مو عندي', 'ar', 4),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'objection_money', 'keyword', 'ما عندي فلوس', 'ar', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'objection_money', 'keyword', 'ضائق', 'ar', 3),
  -- Angry
  ('aaaaaaaa-0000-4000-8000-000000000001', 'angry', 'keyword', 'محكمة', 'ar', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'angry', 'keyword', 'بشتكي', 'ar', 4),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'angry', 'keyword', 'ما لكم حق', 'ar', 5),
  -- No answer
  ('aaaaaaaa-0000-4000-8000-000000000001', 'no_answer', 'phrase', 'الرقم مغلق', 'ar', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'no_answer', 'keyword', 'مشغول', 'ar', 3),
  -- Wrong number
  ('aaaaaaaa-0000-4000-8000-000000000001', 'wrong_number', 'phrase', 'رقم خطأ', 'ar', 5),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'wrong_number', 'phrase', 'مو أنا', 'ar', 4)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 4. EXTEND tenant_usage with missing tracking columns
-- ============================================================

ALTER TABLE public.tenant_usage
  ADD COLUMN IF NOT EXISTS messages_count     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS campaigns_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS users_count        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customers_count    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debts_count        INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_cache_hits      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_template_hits   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_memory_hits     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_openai_calls    INTEGER DEFAULT 0;

-- ============================================================
-- 5. USAGE EVENTS — granular per-action tracking
-- Every tracked action emits one row here.
-- Aggregated nightly into tenant_usage.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usage_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL
               CHECK (event_type IN (
                 'ai_action','message_sent','campaign_sent',
                 'debt_created','customer_created','user_invited',
                 'whatsapp_sent','call_initiated',
                 'response_cache_hit','response_template_hit','response_memory_hit',
                 'openai_call','score_generated'
               )),
  -- Source attribution
  user_id      UUID REFERENCES public.profiles(id),
  debt_id      UUID REFERENCES public.debts(id),
  customer_id  UUID REFERENCES public.customers(id),
  -- Metadata
  metadata     JSONB DEFAULT '{}',
  cost_usd     DECIMAL(10,6) DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'usage_events' AND policyname = 'ue_select'
  ) THEN
    CREATE POLICY "ue_select" ON public.usage_events
      FOR SELECT
      USING (company_id = public.get_user_company_id()
             AND public.get_user_role() IN ('admin','manager'));
    CREATE POLICY "ue_insert" ON public.usage_events
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

-- Service role can insert without RLS
CREATE POLICY "ue_service_insert" ON public.usage_events
  FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ue_company_date
  ON public.usage_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ue_company_type
  ON public.usage_events (company_id, event_type, created_at DESC);

-- ============================================================
-- 6. Function: increment tenant_usage counters
-- Called by the usage tracker lib after every tracked event.
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_usage(
  p_company_id UUID,
  p_period     TEXT,
  p_field      TEXT,
  p_amount     INTEGER DEFAULT 1
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.tenant_usage (company_id, period)
  VALUES (p_company_id, p_period)
  ON CONFLICT (company_id, period) DO NOTHING;

  -- Dynamic field update (validated against allowed column names)
  IF p_field = 'ai_calls_used' THEN
    UPDATE public.tenant_usage SET ai_calls_used = ai_calls_used + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'messages_count' THEN
    UPDATE public.tenant_usage SET messages_count = messages_count + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'campaigns_count' THEN
    UPDATE public.tenant_usage SET campaigns_count = campaigns_count + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'whatsapp_sent' THEN
    UPDATE public.tenant_usage SET whatsapp_sent = whatsapp_sent + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'debts_count' THEN
    UPDATE public.tenant_usage SET debts_count = debts_count + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'customers_count' THEN
    UPDATE public.tenant_usage SET customers_count = customers_count + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'users_count' THEN
    UPDATE public.tenant_usage SET users_count = users_count + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'ai_cache_hits' THEN
    UPDATE public.tenant_usage SET ai_cache_hits = ai_cache_hits + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'ai_template_hits' THEN
    UPDATE public.tenant_usage SET ai_template_hits = ai_template_hits + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'ai_memory_hits' THEN
    UPDATE public.tenant_usage SET ai_memory_hits = ai_memory_hits + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  ELSIF p_field = 'ai_openai_calls' THEN
    UPDATE public.tenant_usage SET ai_openai_calls = ai_openai_calls + p_amount
    WHERE company_id = p_company_id AND period = p_period;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_usage(UUID, TEXT, TEXT, INTEGER)
  TO authenticated, service_role;

COMMIT;
