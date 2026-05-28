-- ================================================================
-- MIGRATION 018: Sync Engine Extended Columns
-- ADD ONLY — no destructive changes. Idempotent.
-- ================================================================
BEGIN;

ALTER TABLE public.debit_collect_sync
  ADD COLUMN IF NOT EXISTS remarks_count      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payments_count     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promises_count     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skip_reason        TEXT,
  ADD COLUMN IF NOT EXISTS ai_memory_imported BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS raw_remarks        JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS raw_payments       JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS raw_promises       JSONB DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_dc_sync_memory
  ON public.debit_collect_sync (company_id, ai_memory_imported)
  WHERE ai_memory_imported = false AND status = 'completed';

COMMIT;
