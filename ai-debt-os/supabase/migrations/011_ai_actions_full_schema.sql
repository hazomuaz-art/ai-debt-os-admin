-- ============================================================
-- MIGRATION 011: ai_actions — complete column set
--
-- Adds every column referenced in the codebase and the
-- required column list. Fully idempotent.
-- Run in: Supabase Dashboard → SQL Editor
-- ============================================================

BEGIN;

-- Core columns guaranteed by migration 001
-- (id, company_id, debt_id, customer_id, action_type, priority,
--  reason, suggested_message, best_time_to_contact,
--  scheduled_for, status, assigned_to, created_at, updated_at)
-- Already exist — ALTER IF NOT EXISTS is safe to repeat.

-- ── Columns added by migration 010 ───────────────────────────
ALTER TABLE public.ai_actions
  ADD COLUMN IF NOT EXISTS scheduled_date       DATE,
  ADD COLUMN IF NOT EXISTS priority_score       INTEGER DEFAULT 50,
  ADD COLUMN IF NOT EXISTS best_time            TEXT,
  ADD COLUMN IF NOT EXISTS best_time_to_contact TEXT,
  ADD COLUMN IF NOT EXISTS outcome              TEXT;

-- ── New columns from requirements ───────────────────────────
ALTER TABLE public.ai_actions
  ADD COLUMN IF NOT EXISTS title                TEXT,
  ADD COLUMN IF NOT EXISTS description          TEXT,
  ADD COLUMN IF NOT EXISTS due_date             DATE,
  ADD COLUMN IF NOT EXISTS scheduled_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recommended_channel  TEXT,
  ADD COLUMN IF NOT EXISTS message_template     TEXT,
  ADD COLUMN IF NOT EXISTS ai_reasoning         TEXT,
  ADD COLUMN IF NOT EXISTS ai_confidence        DECIMAL(5,4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata             JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS generated_by_ai      BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by           UUID REFERENCES public.profiles(id);

-- ── Back-fill scheduled_date from scheduled_for ───────────────
UPDATE public.ai_actions
  SET scheduled_date = scheduled_for::DATE
  WHERE scheduled_date IS NULL AND scheduled_for IS NOT NULL;

-- ── Back-fill scheduled_at from scheduled_for ────────────────
UPDATE public.ai_actions
  SET scheduled_at = scheduled_for::TIMESTAMPTZ
  WHERE scheduled_at IS NULL AND scheduled_for IS NOT NULL;

-- ── Back-fill title from action_type ─────────────────────────
UPDATE public.ai_actions
  SET title = initcap(replace(action_type, '_', ' ')) || ' — ' || left(coalesce(reason,''), 50)
  WHERE title IS NULL;

-- ── Sync trigger: keep scheduled_date / scheduled_for / scheduled_at in sync
CREATE OR REPLACE FUNCTION public.sync_ai_action_schedule()
RETURNS TRIGGER AS $$
BEGIN
  -- scheduled_date → scheduled_for + scheduled_at
  IF NEW.scheduled_date IS NOT NULL THEN
    NEW.scheduled_for := NEW.scheduled_date;
    IF NEW.scheduled_at IS NULL THEN
      NEW.scheduled_at := NEW.scheduled_date::TIMESTAMPTZ;
    END IF;
  END IF;
  -- scheduled_for → scheduled_date + scheduled_at
  IF NEW.scheduled_for IS NOT NULL THEN
    NEW.scheduled_date := NEW.scheduled_for::DATE;
    IF NEW.scheduled_at IS NULL THEN
      NEW.scheduled_at := NEW.scheduled_for::TIMESTAMPTZ;
    END IF;
  END IF;
  -- Auto-set title if blank
  IF NEW.title IS NULL OR NEW.title = '' THEN
    NEW.title := initcap(replace(NEW.action_type, '_', ' ')) || ' — ' || left(coalesce(NEW.reason,''), 50);
  END IF;
  -- Auto-set description if blank
  IF NEW.description IS NULL OR NEW.description = '' THEN
    NEW.description := coalesce(NEW.reason, '');
  END IF;
  -- Auto-set completed_at when status becomes completed
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_ai_action_schedule_trigger ON public.ai_actions;
CREATE TRIGGER sync_ai_action_schedule_trigger
  BEFORE INSERT OR UPDATE ON public.ai_actions
  FOR EACH ROW EXECUTE FUNCTION public.sync_ai_action_schedule();

-- ── Widen action_type constraint if it exists ─────────────────
ALTER TABLE public.ai_actions DROP CONSTRAINT IF EXISTS ai_actions_action_type_check;
ALTER TABLE public.ai_actions ADD CONSTRAINT ai_actions_action_type_check
  CHECK (action_type IN ('call','whatsapp','email','visit','legal','escalate','settle','sms','review'));

-- ── Widen priority constraint ─────────────────────────────────
ALTER TABLE public.ai_actions DROP CONSTRAINT IF EXISTS ai_actions_priority_check;
ALTER TABLE public.ai_actions ADD CONSTRAINT ai_actions_priority_check
  CHECK (priority IN ('low','medium','high','critical'));

-- ── Widen status constraint ───────────────────────────────────
ALTER TABLE public.ai_actions DROP CONSTRAINT IF EXISTS ai_actions_status_check;
ALTER TABLE public.ai_actions ADD CONSTRAINT ai_actions_status_check
  CHECK (status IN ('pending','in_progress','completed','cancelled','skipped'));

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ai_actions_company_sched
  ON public.ai_actions (company_id, scheduled_for, status);
CREATE INDEX IF NOT EXISTS idx_ai_actions_company_date
  ON public.ai_actions (company_id, scheduled_date, status);
CREATE INDEX IF NOT EXISTS idx_ai_actions_assigned
  ON public.ai_actions (assigned_to, scheduled_for)
  WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_actions_debt
  ON public.ai_actions (debt_id, company_id);

COMMIT;
