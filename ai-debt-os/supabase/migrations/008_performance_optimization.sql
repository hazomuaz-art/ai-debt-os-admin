-- ============================================================
-- MIGRATION 008: Database Performance Optimization
-- ============================================================
-- Covers:
--   1. Partial indexes for common filtered queries
--   2. Connection pooling configuration (PgBouncer hints)
--   3. Table statistics tuning for query planner
--   4. Materialized view for dashboard analytics
--   5. Optimized company stats function
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: Partial indexes (dramatically faster filtered queries)
-- ============================================================

-- Active debts (most queries filter on non-settled debts)
CREATE INDEX IF NOT EXISTS idx_debts_active
  ON public.debts (company_id, priority, current_balance DESC)
  WHERE status NOT IN ('settled', 'written_off');

-- Overdue debts (critical for collector queues)
CREATE INDEX IF NOT EXISTS idx_debts_overdue
  ON public.debts (company_id, due_date, current_balance DESC)
  WHERE status NOT IN ('settled', 'written_off')
    AND due_date < CURRENT_DATE;

-- Unassigned debts (for assignment workflow)
CREATE INDEX IF NOT EXISTS idx_debts_unassigned
  ON public.debts (company_id, created_at DESC)
  WHERE assigned_to IS NULL
    AND status NOT IN ('settled', 'written_off');

-- Pending job queue items (processed every 2 min)
CREATE INDEX IF NOT EXISTS idx_jobs_pending_priority
  ON public.job_queue (priority ASC, scheduled_at ASC)
  WHERE status IN ('pending', 'retrying');

-- Active API keys lookup (hot path for every API request using key auth)
CREATE INDEX IF NOT EXISTS idx_api_keys_active
  ON public.api_keys (key_hash)
  WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW());

-- Recent AI scores per debt (for debt detail pages)
CREATE INDEX IF NOT EXISTS idx_ai_scores_debt_recent
  ON public.ai_scores (debt_id, created_at DESC);

-- Today's AI actions per company (action plan page)
CREATE INDEX IF NOT EXISTS idx_ai_actions_today
  ON public.ai_actions (company_id, assigned_to, priority_score DESC)
  WHERE scheduled_date = CURRENT_DATE AND status = 'pending';

-- Inbound messages (for customer communication history)
CREATE INDEX IF NOT EXISTS idx_messages_inbound
  ON public.messages (company_id, customer_id, created_at DESC)
  WHERE direction = 'inbound';

-- Failed messages (for retry queue)
CREATE INDEX IF NOT EXISTS idx_messages_failed
  ON public.messages (company_id, created_at DESC)
  WHERE status = 'failed';

-- ============================================================
-- SECTION 2: Composite indexes for join-heavy queries
-- ============================================================

-- Debt list query: company + status + priority + created_at
CREATE INDEX IF NOT EXISTS idx_debts_list_query
  ON public.debts (company_id, status, priority, created_at DESC);

-- Payment history per debt (sorted by date)
CREATE INDEX IF NOT EXISTS idx_payments_debt_date
  ON public.payments (debt_id, payment_date DESC);

-- Logs per company per entity (audit trail queries)
CREATE INDEX IF NOT EXISTS idx_logs_entity
  ON public.logs (company_id, entity_type, entity_id, created_at DESC);

-- ============================================================
-- SECTION 3: Statistics targets for heavily-filtered columns
-- (helps query planner make better index decisions)
-- ============================================================

ALTER TABLE public.debts
  ALTER COLUMN status      SET STATISTICS 500,
  ALTER COLUMN priority    SET STATISTICS 200,
  ALTER COLUMN company_id  SET STATISTICS 100;

ALTER TABLE public.payments
  ALTER COLUMN payment_date SET STATISTICS 500,
  ALTER COLUMN company_id   SET STATISTICS 100;

ALTER TABLE public.messages
  ALTER COLUMN direction  SET STATISTICS 200,
  ALTER COLUMN channel    SET STATISTICS 200,
  ALTER COLUMN status     SET STATISTICS 200;

-- Force immediate statistics update on key tables
ANALYZE public.debts;
ANALYZE public.customers;
ANALYZE public.payments;
ANALYZE public.messages;
ANALYZE public.profiles;

-- ============================================================
-- SECTION 4: Optimized company stats function
-- Used by admin dashboard — replaces N individual queries
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_company_stats(p_company_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Verify caller has access to this company
  IF public.get_user_company_id() != p_company_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT jsonb_build_object(
    -- Debt counts and totals
    'total_debts',          COUNT(*)                                  FILTER (WHERE status != 'written_off'),
    'active_debts',         COUNT(*)                                  FILTER (WHERE status NOT IN ('settled','written_off')),
    'settled_debts',        COUNT(*)                                  FILTER (WHERE status = 'settled'),
    'overdue_debts',        COUNT(*)                                  FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('settled','written_off')),
    'critical_debts',       COUNT(*)                                  FILTER (WHERE priority = 'critical' AND status NOT IN ('settled','written_off')),
    'unassigned_debts',     COUNT(*)                                  FILTER (WHERE assigned_to IS NULL AND status NOT IN ('settled','written_off')),
    -- Financial totals
    'total_portfolio',      COALESCE(SUM(original_amount)             FILTER (WHERE status != 'written_off'), 0),
    'total_outstanding',    COALESCE(SUM(current_balance)             FILTER (WHERE status NOT IN ('settled','written_off')), 0),
    'total_collected',      COALESCE(SUM(original_amount - current_balance) FILTER (WHERE status != 'written_off'), 0),
    -- This month
    'debts_this_month',     COUNT(*)                                  FILTER (WHERE date_trunc('month', created_at) = date_trunc('month', NOW())),
    -- Priority breakdown
    'by_priority', jsonb_build_object(
      'critical', COUNT(*) FILTER (WHERE priority = 'critical' AND status NOT IN ('settled','written_off')),
      'high',     COUNT(*) FILTER (WHERE priority = 'high'     AND status NOT IN ('settled','written_off')),
      'medium',   COUNT(*) FILTER (WHERE priority = 'medium'   AND status NOT IN ('settled','written_off')),
      'low',      COUNT(*) FILTER (WHERE priority = 'low'      AND status NOT IN ('settled','written_off'))
    ),
    -- Status breakdown
    'by_status', jsonb_object_agg(status, status_count)
  ) INTO v_result
  FROM public.debts
  CROSS JOIN LATERAL (
    SELECT status, COUNT(*) AS status_count
    FROM public.debts d2
    WHERE d2.company_id = p_company_id
    GROUP BY status
  ) status_counts
  WHERE company_id = p_company_id;

  -- Monthly payments (last 6 months) as a separate aggregation
  -- Appended to result
  v_result := v_result || jsonb_build_object(
    'monthly_collections', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'month',     to_char(date_trunc('month', payment_date), 'YYYY-MM'),
          'collected', SUM(amount),
          'count',     COUNT(*)
        )
        ORDER BY date_trunc('month', payment_date)
      )
      FROM public.payments
      WHERE company_id = p_company_id
        AND payment_date >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY date_trunc('month', payment_date)
    )
  );

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- Grant execute to authenticated users (RLS inside the function restricts by company)
GRANT EXECUTE ON FUNCTION public.get_company_stats(UUID) TO authenticated;

-- ============================================================
-- SECTION 5: Optimized function for collector queue
-- Returns collector's assigned debts sorted by priority
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_collector_queue(
  p_collector_id UUID,
  p_limit        INTEGER DEFAULT 20,
  p_offset       INTEGER DEFAULT 0
)
RETURNS TABLE (
  id               UUID,
  reference_number TEXT,
  original_amount  DECIMAL,
  current_balance  DECIMAL,
  currency         TEXT,
  status           TEXT,
  priority         TEXT,
  due_date         DATE,
  days_overdue     INTEGER,
  customer_name    TEXT,
  customer_phone   TEXT,
  customer_whatsapp TEXT,
  latest_ai_score  INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify this is the collector themselves or an admin/manager
  IF auth.uid() != p_collector_id AND NOT public.is_admin_or_manager() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.reference_number,
    d.original_amount,
    d.current_balance,
    d.currency,
    d.status,
    d.priority,
    d.due_date,
    GREATEST(0, (CURRENT_DATE - d.due_date)::INTEGER) AS days_overdue,
    c.full_name     AS customer_name,
    c.phone         AS customer_phone,
    c.whatsapp      AS customer_whatsapp,
    (
      SELECT score FROM public.ai_scores
      WHERE ai_scores.debt_id = d.id
      ORDER BY created_at DESC LIMIT 1
    ) AS latest_ai_score
  FROM public.debts d
  JOIN public.customers c ON c.id = d.customer_id
  WHERE d.assigned_to   = p_collector_id
    AND d.company_id    = public.get_user_company_id()
    AND d.status NOT IN ('settled', 'written_off')
  ORDER BY
    -- Sort: critical first, then by days overdue, then balance
    CASE d.priority
      WHEN 'critical' THEN 0
      WHEN 'high'     THEN 1
      WHEN 'medium'   THEN 2
      ELSE                 3
    END,
    COALESCE(d.due_date, '9999-12-31') ASC,
    d.current_balance DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_collector_queue(UUID, INTEGER, INTEGER) TO authenticated;

-- ============================================================
-- SECTION 6: pg_stat_statements (if available) for query tracking
-- ============================================================

-- Enable query stats (Supabase enables this by default on Pro plans)
-- This just ensures the extension is available for monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- ============================================================
-- SECTION 7: Connection pool hints via config
-- (These are advisory comments for PgBouncer/Supavisor configuration)
-- ============================================================

-- Supabase uses Supavisor as the connection pooler.
-- Recommended settings for this schema:
--
-- pool_mode = transaction       (safest for serverless)
-- max_client_conn = 1000
-- default_pool_size = 20
--
-- For the application layer, use the pooler URL (port 6543) in production,
-- not the direct connection (port 5432).
-- The Supabase dashboard provides both under: Settings → Database → Connection string
--
-- Set in .env.local:
-- DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres

COMMIT;
