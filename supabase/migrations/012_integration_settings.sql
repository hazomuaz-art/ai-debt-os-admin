-- ============================================================
-- MIGRATION 012: integration_settings table
-- Run in: Supabase Dashboard → SQL Editor
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.integration_settings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  integration_name TEXT NOT NULL
                   CHECK (integration_name IN ('rasf_whatsapp','tameez_calls','collection_api')),
  enabled          BOOLEAN NOT NULL DEFAULT false,
  config           JSONB NOT NULL DEFAULT '{}',
  last_synced_at   TIMESTAMPTZ,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, integration_name)
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_integration_settings()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_integration_settings_trigger ON public.integration_settings;
CREATE TRIGGER touch_integration_settings_trigger
  BEFORE UPDATE ON public.integration_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_integration_settings();

-- RLS
ALTER TABLE public.integration_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'integration_settings' AND policyname = 'integrations_select'
  ) THEN
    CREATE POLICY "integrations_select" ON public.integration_settings
      FOR SELECT USING (company_id = public.get_user_company_id());

    CREATE POLICY "integrations_insert" ON public.integration_settings
      FOR INSERT WITH CHECK (
        company_id = public.get_user_company_id()
        AND public.get_user_role() = 'admin'
      );

    CREATE POLICY "integrations_update" ON public.integration_settings
      FOR UPDATE USING (
        company_id = public.get_user_company_id()
        AND public.get_user_role() = 'admin'
      ) WITH CHECK (company_id = public.get_user_company_id());

    CREATE POLICY "integrations_delete" ON public.integration_settings
      FOR DELETE USING (
        company_id = public.get_user_company_id()
        AND public.get_user_role() = 'admin'
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_integration_settings_company
  ON public.integration_settings (company_id, integration_name);

COMMIT;
