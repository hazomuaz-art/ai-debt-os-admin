-- ============================================================
-- MIGRATION 023: Import mapping templates (Import Engine memory)
--
-- Lets the generic import engine remember a manually-confirmed column
-- mapping for a given "row layout" (a cluster of rows sharing the same
-- set of non-empty columns — e.g. "insurance-shaped rows", "telecom-shaped
-- rows"). Keyed by company_id + a hash of the cluster's active-column
-- signature, NOT by file name or column position — so the same learned
-- mapping is reapplied automatically to any future file containing rows
-- with that same shape, even mixed with other layouts in one sheet.
--
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.import_mapping_templates (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- Stable hash of the sorted set of normalized header names that were
  -- non-empty for the rows in this cluster (the "row layout signature").
  signature_hash      TEXT NOT NULL,
  -- The exact header names that made up the signature, for human display
  -- in diagnostics (not used for matching — signature_hash is canonical).
  signature_headers    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Confirmed column header -> standard field mapping, e.g.
  -- {"اسم المالك": "full_name", "رقم جوال المالك": "phone"}.
  field_map           JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Optional human label shown in future diagnostics, e.g. "صفوف تأمين".
  label               TEXT,
  confirmed_by        UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  use_count           INT NOT NULL DEFAULT 0,
  last_used_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, signature_hash)
);

CREATE INDEX IF NOT EXISTS idx_import_mapping_templates_company
  ON public.import_mapping_templates(company_id);

ALTER TABLE public.import_mapping_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_mapping_templates_company_isolation ON public.import_mapping_templates;
CREATE POLICY import_mapping_templates_company_isolation ON public.import_mapping_templates
  USING (company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.profiles WHERE id = auth.uid()));

COMMIT;
