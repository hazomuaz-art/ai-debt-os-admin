-- ============================================================
-- MIGRATION 010: Fix all schema gaps for production
--
-- IDEMPOTENT — safe to run multiple times.
-- Run this in Supabase SQL Editor (this is the only migration
-- you need to run if 001 and 002 are already applied).
-- ============================================================

BEGIN;

-- ============================================================
-- 1. DEBTS — add missing columns
-- ============================================================

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS last_payment_date DATE,
  ADD COLUMN IF NOT EXISTS interest_rate DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS next_follow_up DATE,
  ADD COLUMN IF NOT EXISTS penalty_amount DECIMAL(15,2) DEFAULT 0;

-- Fix status constraint to include all values the app uses
ALTER TABLE public.debts DROP CONSTRAINT IF EXISTS debts_status_check;
ALTER TABLE public.debts ADD CONSTRAINT debts_status_check
  CHECK (status IN (
    'active', 'in_progress', 'promised', 'partial',
    'in_negotiation', 'payment_plan',
    'settled', 'written_off', 'legal', 'disputed'
  ));

-- ============================================================
-- 2. AI_ACTIONS — add missing columns + sync scheduled_date/for
-- ============================================================

ALTER TABLE public.ai_actions
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS best_time TEXT,
  ADD COLUMN IF NOT EXISTS best_time_to_contact TEXT,
  ADD COLUMN IF NOT EXISTS outcome TEXT;

UPDATE public.ai_actions SET scheduled_date = scheduled_for WHERE scheduled_date IS NULL;

CREATE OR REPLACE FUNCTION public.sync_ai_action_dates()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.scheduled_date IS NOT NULL THEN
    NEW.scheduled_for := NEW.scheduled_date;
  ELSIF NEW.scheduled_for IS NOT NULL THEN
    NEW.scheduled_date := NEW.scheduled_for;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_ai_action_dates_trigger ON public.ai_actions;
CREATE TRIGGER sync_ai_action_dates_trigger
  BEFORE INSERT OR UPDATE ON public.ai_actions
  FOR EACH ROW EXECUTE FUNCTION public.sync_ai_action_dates();

-- ============================================================
-- 3. MESSAGES — add missing columns, make customer_id nullable
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS whatsapp_status TEXT,
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES public.profiles(id);

ALTER TABLE public.messages ALTER COLUMN customer_id DROP NOT NULL;

-- ============================================================
-- 4. PAYMENTS — fix constraint to include 'card'
-- ============================================================

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method IN ('cash', 'bank_transfer', 'card', 'check', 'online', 'other'));

-- ============================================================
-- 5. CUSTOMERS — ensure whatsapp column exists
-- ============================================================

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS whatsapp TEXT;

-- ============================================================
-- 6. LOGS — add missing columns, widen entity_type constraint
-- ============================================================

ALTER TABLE public.logs
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT;

ALTER TABLE public.logs DROP CONSTRAINT IF EXISTS logs_entity_type_check;
ALTER TABLE public.logs ADD CONSTRAINT logs_entity_type_check
  CHECK (entity_type IN (
    'debt', 'customer', 'payment', 'message',
    'ai_action', 'user', 'company', 'score'
  ));

-- ============================================================
-- 7. RATE LIMITS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key          TEXT NOT NULL,
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  limit_max    INTEGER NOT NULL DEFAULT 100,
  UNIQUE (key, company_id, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='rate_limits' AND policyname='rate_limits_all') THEN
    CREATE POLICY "rate_limits_all" ON public.rate_limits FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON public.rate_limits (key, company_id, window_start DESC);

-- ============================================================
-- 8. check_and_increment_rate_limit function
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_key        TEXT,
  p_company_id UUID,
  p_limit_max  INTEGER DEFAULT 100,
  p_window     INTERVAL DEFAULT '1 hour'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_count        INTEGER;
BEGIN
  v_window_start := date_trunc('hour', NOW());
  INSERT INTO public.rate_limits (key, company_id, window_start, count, limit_max)
  VALUES (p_key, p_company_id, v_window_start, 1, p_limit_max)
  ON CONFLICT (key, company_id, window_start)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO v_count;
  RETURN v_count <= p_limit_max;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(TEXT,UUID,INTEGER,INTERVAL)
  TO authenticated, service_role;

-- ============================================================
-- 9. JOB QUEUE TABLE AND FUNCTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_type     TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','processing','completed','failed','retrying')),
  priority     INTEGER NOT NULL DEFAULT 5,
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error   TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by   UUID REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='job_queue' AND policyname='job_queue_select') THEN
    CREATE POLICY "job_queue_select" ON public.job_queue
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "job_queue_insert" ON public.job_queue
      FOR INSERT WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_job_queue_pending
  ON public.job_queue (status, priority, scheduled_at)
  WHERE status IN ('pending','retrying');

CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_company_id UUID,
  p_job_type   TEXT,
  p_payload    JSONB    DEFAULT '{}',
  p_priority   INTEGER  DEFAULT 5,
  p_created_by UUID     DEFAULT NULL,
  p_delay      INTERVAL DEFAULT '0 seconds'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO public.job_queue (company_id, job_type, payload, priority, created_by, scheduled_at)
  VALUES (p_company_id, p_job_type, p_payload, p_priority, p_created_by, NOW() + p_delay)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_job(UUID,TEXT,JSONB,INTEGER,UUID,INTERVAL) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recover_stale_jobs()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.job_queue
  SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retrying' END,
      last_error = 'Recovered from stale state'
  WHERE status = 'processing' AND started_at < NOW() - INTERVAL '10 minutes';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recover_stale_jobs() TO service_role;

CREATE OR REPLACE FUNCTION public.run_scheduled_cleanup()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_rl INTEGER; v_jq INTEGER;
BEGIN
  DELETE FROM public.rate_limits WHERE window_start < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_rl = ROW_COUNT;
  DELETE FROM public.job_queue WHERE status IN ('completed','failed') AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_jq = ROW_COUNT;
  RETURN format('Cleaned %s rate limits, %s old jobs', v_rl, v_jq);
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_scheduled_cleanup() TO service_role;

-- ============================================================
-- 10. WEBHOOK EVENTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider     TEXT NOT NULL DEFAULT 'whatsapp',
  event_id     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_lookup
  ON public.webhook_events (provider, event_id);

-- ============================================================
-- 11. Rebuild helper functions with proper security
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT company_id FROM public.profiles WHERE id = auth.uid() LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1; $$;

-- ============================================================
-- 12. Performance indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_debts_company_status   ON public.debts (company_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_company_created  ON public.debts (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_actions_sched_for   ON public.ai_actions (company_id, scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_ai_actions_sched_date  ON public.ai_actions (company_id, scheduled_date, status);
CREATE INDEX IF NOT EXISTS idx_messages_wa_msg_id     ON public.messages (whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_whatsapp     ON public.customers (company_id, whatsapp) WHERE whatsapp IS NOT NULL;

COMMIT;
