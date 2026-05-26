-- ============================================================
-- MIGRATION 007: Scheduled Jobs via pg_cron
-- 
-- PREREQUISITE: Enable pg_cron extension in Supabase Dashboard
--   Dashboard → Database → Extensions → pg_cron → Enable
--
-- These run inside the database and don't require external cron.
-- ============================================================

BEGIN;

-- Enable pg_cron (safe to run if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres role (pg_cron runs as postgres)
GRANT USAGE ON SCHEMA cron TO postgres;

-- ============================================================
-- Remove old schedules (idempotent re-run safety)
-- ============================================================

SELECT cron.unschedule('cleanup-rate-limits')    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-rate-limits');
SELECT cron.unschedule('cleanup-webhook-events') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-webhook-events');
SELECT cron.unschedule('recover-stale-jobs')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recover-stale-jobs');
SELECT cron.unschedule('full-cleanup')           WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'full-cleanup');

-- ============================================================
-- Schedule 1: Recover stale jobs every 5 minutes
-- Detects and requeues jobs that crashed mid-processing
-- ============================================================

SELECT cron.schedule(
  'recover-stale-jobs',
  '*/5 * * * *',
  $$SELECT public.recover_stale_jobs();$$
);

-- ============================================================
-- Schedule 2: Full cleanup daily at 2 AM UTC
-- Cleans rate limits, webhook events, old completed jobs
-- ============================================================

SELECT cron.schedule(
  'full-cleanup',
  '0 2 * * *',
  $$SELECT public.run_scheduled_cleanup();$$
);

-- ============================================================
-- Schedule 3: Cleanup expired auth sessions daily at 3 AM
-- ============================================================

SELECT cron.schedule(
  'cleanup-sessions',
  '0 3 * * *',
  $$SELECT public.cleanup_expired_sessions();$$
);

-- ============================================================
-- Schedule 4: Update usage metrics snapshot (daily at midnight)
-- ============================================================

SELECT cron.schedule(
  'snapshot-usage',
  '0 0 * * *',
  $$
  -- Reset monthly counters at start of month is handled by the
  -- UPSERT with period key; this just ensures the row exists
  INSERT INTO public.usage_metrics (company_id, metric, value, period)
  SELECT id, 'snapshot_taken', 1, to_char(NOW(), 'YYYY-MM')
  FROM public.companies
  WHERE is_active = true
  ON CONFLICT (company_id, metric, period) DO UPDATE
    SET updated_at = NOW();
  $$
);

COMMIT;
