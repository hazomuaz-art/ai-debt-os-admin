-- ============================================================
-- MIGRATION 004: Background Jobs, Rate Limiting, Idempotency
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: Job Queue
-- Used for async AI scoring, bulk import, WhatsApp batches
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_type      TEXT NOT NULL,  -- 'score_debt' | 'score_batch' | 'send_whatsapp' | 'import_csv' | 'generate_actions'
  payload       JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'retrying')),
  priority      INTEGER NOT NULL DEFAULT 5,  -- 1=highest, 10=lowest
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  last_error    TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_by    UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_select_admin_manager"
  ON public.job_queue
  FOR SELECT
  USING (company_id = public.get_user_company_id() AND public.is_admin_or_manager());

CREATE POLICY "job_insert"
  ON public.job_queue
  FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

-- Only service role processes jobs (no UPDATE policy for regular users)

CREATE INDEX idx_job_queue_pending
  ON public.job_queue (status, priority, scheduled_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX idx_job_queue_company
  ON public.job_queue (company_id, status, created_at DESC);

-- ============================================================
-- SECTION 2: Rate Limiting Table
-- Tracks API call counts per company per window
-- ============================================================

CREATE TABLE IF NOT EXISTS public.rate_limits (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key         TEXT NOT NULL,          -- e.g. 'ai_score:company_id' or 'whatsapp:company_id'
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  window_start TIMESTAMPTZ NOT NULL,  -- start of the current window
  window_size  INTERVAL NOT NULL DEFAULT '1 hour',
  count       INTEGER NOT NULL DEFAULT 0,
  limit_max   INTEGER NOT NULL DEFAULT 100,
  UNIQUE (key, company_id, window_start)
);

ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
-- Only service role reads/writes rate limits

CREATE INDEX idx_rate_limits_key_window
  ON public.rate_limits (key, company_id, window_start DESC);

-- Clean up old rate limit windows automatically
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limits()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.rate_limits
  WHERE window_start < NOW() - INTERVAL '24 hours';
$$;

-- ============================================================
-- SECTION 3: WhatsApp Webhook Idempotency
-- Prevents duplicate processing of webhook events
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider          TEXT NOT NULL DEFAULT 'whatsapp',
  event_id          TEXT NOT NULL,   -- WhatsApp message ID / status ID
  event_type        TEXT NOT NULL,   -- 'message' | 'status'
  payload           JSONB NOT NULL,
  processed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, event_id)        -- idempotency key
);

-- Partition this by provider for scale; for now just index
CREATE INDEX idx_webhook_events_provider_id
  ON public.webhook_events (provider, event_id);

-- Auto-delete events older than 7 days (they're only needed for dedup)
CREATE OR REPLACE FUNCTION public.cleanup_old_webhook_events()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.webhook_events
  WHERE processed_at < NOW() - INTERVAL '7 days';
$$;

-- ============================================================
-- SECTION 4: Company Usage Metrics (for billing/limits)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.usage_metrics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  metric      TEXT NOT NULL,  -- 'ai_scores_this_month' | 'messages_this_month' | 'debts_total'
  value       BIGINT NOT NULL DEFAULT 0,
  period      TEXT NOT NULL,  -- '2025-01' format for monthly metrics
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, metric, period)
);

ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_select_admin"
  ON public.usage_metrics
  FOR SELECT
  USING (company_id = public.get_user_company_id() AND public.is_admin());

CREATE INDEX idx_usage_metrics_company_period
  ON public.usage_metrics (company_id, period, metric);

-- ============================================================
-- SECTION 5: Function to atomically increment rate limit
-- Returns true if request is allowed, false if rate limited
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
  -- Truncate to window boundary
  v_window_start := date_trunc('hour', NOW());

  INSERT INTO public.rate_limits (key, company_id, window_start, window_size, count, limit_max)
  VALUES (p_key, p_company_id, v_window_start, p_window, 1, p_limit_max)
  ON CONFLICT (key, company_id, window_start)
  DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= p_limit_max;
END;
$$;

-- ============================================================
-- SECTION 6: Function to enqueue a background job
-- ============================================================

CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_company_id UUID,
  p_job_type   TEXT,
  p_payload    JSONB,
  p_priority   INTEGER DEFAULT 5,
  p_created_by UUID DEFAULT NULL,
  p_delay      INTERVAL DEFAULT '0 seconds'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_id UUID;
BEGIN
  INSERT INTO public.job_queue (company_id, job_type, payload, priority, created_by, scheduled_at)
  VALUES (p_company_id, p_job_type, p_payload, p_priority, p_created_by, NOW() + p_delay)
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$;

-- ============================================================
-- SECTION 7: Audit log trigger — auto-log debt status changes
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_debt_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only log meaningful field changes
    IF NEW.status != OLD.status
       OR NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
       OR NEW.current_balance != OLD.current_balance
       OR NEW.priority != OLD.priority
    THEN
      INSERT INTO public.logs (
        company_id, entity_type, entity_id, action, old_values, new_values
      ) VALUES (
        NEW.company_id,
        'debt',
        NEW.id,
        CASE
          WHEN NEW.status != OLD.status THEN 'status_changed'
          WHEN NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN 'reassigned'
          WHEN NEW.current_balance != OLD.current_balance THEN 'balance_updated'
          WHEN NEW.priority != OLD.priority THEN 'priority_changed'
          ELSE 'updated'
        END,
        jsonb_build_object(
          'status', OLD.status,
          'assigned_to', OLD.assigned_to,
          'current_balance', OLD.current_balance,
          'priority', OLD.priority
        ),
        jsonb_build_object(
          'status', NEW.status,
          'assigned_to', NEW.assigned_to,
          'current_balance', NEW.current_balance,
          'priority', NEW.priority
        )
      );
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.logs (
      company_id, entity_type, entity_id, action, new_values
    ) VALUES (
      NEW.company_id,
      'debt',
      NEW.id,
      'created',
      jsonb_build_object(
        'reference_number', NEW.reference_number,
        'original_amount', NEW.original_amount,
        'currency', NEW.currency,
        'customer_id', NEW.customer_id
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS debt_audit_trigger ON public.debts;
CREATE TRIGGER debt_audit_trigger
  AFTER INSERT OR UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.audit_debt_changes();

-- Audit trigger for payments
CREATE OR REPLACE FUNCTION public.audit_payment_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.logs (
    company_id, entity_type, entity_id, action, new_values, user_id
  ) VALUES (
    NEW.company_id,
    'payment',
    NEW.id,
    'payment_recorded',
    jsonb_build_object(
      'amount', NEW.amount,
      'currency', NEW.currency,
      'debt_id', NEW.debt_id,
      'payment_method', NEW.payment_method,
      'payment_date', NEW.payment_date
    ),
    NEW.recorded_by
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_audit_trigger ON public.payments;
CREATE TRIGGER payment_audit_trigger
  AFTER INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_payment_insert();

-- ============================================================
-- SECTION 8: Usage metrics trigger — increment on insert
-- ============================================================

CREATE OR REPLACE FUNCTION public.increment_usage_metric(
  p_company_id UUID,
  p_metric     TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.usage_metrics (company_id, metric, value, period)
  VALUES (p_company_id, p_metric, 1, to_char(NOW(), 'YYYY-MM'))
  ON CONFLICT (company_id, metric, period)
  DO UPDATE SET value = usage_metrics.value + 1, updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.track_ai_score_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.increment_usage_metric(NEW.company_id, 'ai_scores');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_score_usage_trigger ON public.ai_scores;
CREATE TRIGGER ai_score_usage_trigger
  AFTER INSERT ON public.ai_scores
  FOR EACH ROW EXECUTE FUNCTION public.track_ai_score_usage();

CREATE OR REPLACE FUNCTION public.track_message_usage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction = 'outbound' THEN
    PERFORM public.increment_usage_metric(NEW.company_id, 'messages_sent');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS message_usage_trigger ON public.messages;
CREATE TRIGGER message_usage_trigger
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.track_message_usage();

-- ============================================================
-- SECTION 9: Scheduled cleanup function (call via pg_cron or Supabase cron)
-- ============================================================

CREATE OR REPLACE FUNCTION public.run_scheduled_cleanup()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleaned_rate_limits INTEGER;
  v_cleaned_webhooks    INTEGER;
  v_cleaned_jobs        INTEGER;
BEGIN
  -- Clean stale rate limit windows
  DELETE FROM public.rate_limits WHERE window_start < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_cleaned_rate_limits = ROW_COUNT;

  -- Clean old webhook events
  DELETE FROM public.webhook_events WHERE processed_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_cleaned_webhooks = ROW_COUNT;

  -- Clean old completed/failed jobs
  DELETE FROM public.job_queue
  WHERE status IN ('completed', 'failed')
    AND created_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_cleaned_jobs = ROW_COUNT;

  RETURN format(
    'Cleaned: %s rate limits, %s webhook events, %s old jobs',
    v_cleaned_rate_limits, v_cleaned_webhooks, v_cleaned_jobs
  );
END;
$$;

-- ============================================================
-- SECTION 10: Stale job recovery
-- Mark jobs processing for >10 mins as retrying
-- ============================================================

CREATE OR REPLACE FUNCTION public.recover_stale_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.job_queue
  SET
    status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retrying' END,
    last_error = 'Job timed out (recovered)'
  WHERE status = 'processing'
    AND started_at < NOW() - INTERVAL '10 minutes';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================
-- SECTION 11: Full-text search on customers and debts
-- ============================================================

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
    GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(full_name, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(phone, '') || ' ' ||
        coalesce(national_id, '') || ' ' ||
        coalesce(city, '') || ' ' ||
        coalesce(employer, '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_customers_search
  ON public.customers USING GIN (search_vector);

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS search_vector TSVECTOR
    GENERATED ALWAYS AS (
      to_tsvector('english',
        coalesce(reference_number, '') || ' ' ||
        coalesce(account_number, '') || ' ' ||
        coalesce(product_type, '') || ' ' ||
        coalesce(notes, '')
      )
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_debts_search
  ON public.debts USING GIN (search_vector);

COMMIT;
