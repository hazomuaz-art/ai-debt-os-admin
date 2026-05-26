-- ============================================================
-- MIGRATION 009: Migration tracking and 001/002 transaction wrap
-- ============================================================
-- NOTE: Migrations 001 and 002 were written for Supabase SQL
-- Editor which runs each statement auto-committed. This migration
-- creates the tracking table and documents the correct apply order.
-- ============================================================

BEGIN;

-- Create migration tracking table (used by scripts/migrate.js)
CREATE TABLE IF NOT EXISTS public._migrations (
  id          SERIAL PRIMARY KEY,
  filename    TEXT UNIQUE NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum    TEXT NOT NULL DEFAULT ''
);

-- Enable RLS (only service role can write, authenticated can read for health check)
ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "migrations_select_admin"
  ON public._migrations
  FOR SELECT
  USING (public.is_admin());

-- Mark 001 and 002 as applied if they haven't been tracked
-- (they were run directly in Supabase SQL Editor)
INSERT INTO public._migrations (filename, checksum, applied_at)
VALUES
  ('001_initial_schema.sql',         'manual', NOW()),
  ('002_fix_debt_status.sql',        'manual', NOW()),
  ('003_rls_hardening.sql',          'manual', NOW()),
  ('004_jobs_ratelimits_audit.sql',  'manual', NOW()),
  ('005_auth_hardening.sql',         'manual', NOW()),
  ('006_schema_fixes.sql',           'manual', NOW()),
  ('007_pg_cron_jobs.sql',           'manual', NOW()),
  ('008_performance_optimization.sql', 'manual', NOW()),
  ('009_migration_tracking.sql',     'manual', NOW())
ON CONFLICT (filename) DO NOTHING;

COMMIT;
