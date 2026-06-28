-- ================================================================
-- MIGRATION 018: Orchestrator Run Log
-- Stores every orchestration run so the auditor can verify
-- which modules ran, succeeded, and failed for each event.
-- ADD ONLY — no DROP, no ALTER of existing columns.
-- IDEMPOTENT — safe to run multiple times.
-- ================================================================
BEGIN;

-- ── orchestrator_runs — one row per event processed ────────────
CREATE TABLE IF NOT EXISTS public.orchestrator_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_source   TEXT NOT NULL,   -- csv_import | webhook_whatsapp | payment_update | …
  debt_id        UUID REFERENCES public.debts(id),
  customer_id    UUID REFERENCES public.customers(id),
  -- What ran
  mode           TEXT,            -- off | test | live
  ai_score       INTEGER,
  ai_risk        TEXT,
  ai_actions_count INTEGER DEFAULT 0,
  alerts_count   INTEGER DEFAULT 0,
  memory_count   INTEGER DEFAULT 0,
  -- Step tracking
  steps_completed TEXT[] DEFAULT '{}',
  steps_skipped   TEXT[] DEFAULT '{}',
  steps_failed    TEXT[] DEFAULT '{}',
  -- Outcome
  success        BOOLEAN DEFAULT false,
  error_message  TEXT,
  duration_ms    INTEGER,
  triggered_by   UUID REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.orchestrator_runs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'orchestrator_runs' AND policyname = 'or_select'
  ) THEN
    CREATE POLICY "or_select" ON public.orchestrator_runs
      FOR SELECT USING (
        company_id = public.get_user_company_id()
        AND public.get_user_role() IN ('admin','manager')
      );
    CREATE POLICY "or_insert" ON public.orchestrator_runs
      FOR INSERT WITH CHECK (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_or_company
  ON public.orchestrator_runs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_or_debt
  ON public.orchestrator_runs (debt_id, created_at DESC)
  WHERE debt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_or_failed
  ON public.orchestrator_runs (company_id, success, created_at DESC)
  WHERE success = false;

-- ── Ensure system_config row exists for every company ──────────
-- (Some companies may have been created before migration 014)
INSERT INTO public.system_config (company_id, automation_mode)
SELECT id, 'off'
FROM   public.companies
WHERE  id NOT IN (SELECT company_id FROM public.system_config)
ON CONFLICT DO NOTHING;

COMMIT;
