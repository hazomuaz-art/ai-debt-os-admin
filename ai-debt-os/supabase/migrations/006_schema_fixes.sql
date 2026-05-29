-- ============================================================
-- MIGRATION 006: Schema consistency and missing columns
-- ============================================================

BEGIN;

-- ============================================================
-- Add whatsapp_status to messages if not exists
-- (for tracking Meta delivery receipts separately from internal status)
-- ============================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS whatsapp_status TEXT
    CHECK (whatsapp_status IN ('sent', 'delivered', 'read', 'failed'));

-- Add sent_at column for messages (webhook provides timestamp)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- Add sent_by to messages (which user sent it; null for webhook-received)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS sent_by UUID REFERENCES public.profiles(id);

-- Ensure metadata column exists on messages
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ============================================================
-- Add missing columns to ai_actions
-- ============================================================

ALTER TABLE public.ai_actions
  ADD COLUMN IF NOT EXISTS best_time TEXT;

ALTER TABLE public.ai_actions
  ADD COLUMN IF NOT EXISTS priority_score INTEGER DEFAULT 50;

-- ============================================================
-- Add description column to debts (alias for notes, for UI)
-- ============================================================

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS description TEXT;

-- ============================================================
-- Ensure customers.whatsapp column exists (canonical name)
-- Some older schemas may have whatsapp_number
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'whatsapp_number'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'whatsapp'
  ) THEN
    ALTER TABLE public.customers RENAME COLUMN whatsapp_number TO whatsapp;
  END IF;
END $$;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS whatsapp TEXT;

-- ============================================================
-- Add last_payment_date to debts if not present
-- ============================================================

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS last_payment_date DATE;

ALTER TABLE public.debts
  ADD COLUMN IF NOT EXISTS interest_rate DECIMAL(5,2) DEFAULT 0;

-- ============================================================
-- Ensure job_queue best_time column exists in ai_actions
-- ============================================================

ALTER TABLE public.ai_actions
  ADD COLUMN IF NOT EXISTS best_time_to_contact TEXT;

-- Copy best_time → best_time_to_contact if both exist
UPDATE public.ai_actions
  SET best_time_to_contact = best_time
  WHERE best_time IS NOT NULL AND best_time_to_contact IS NULL;

-- ============================================================
-- Add index for messages by WhatsApp message ID (status updates)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_messages_wa_msg_id
  ON public.messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- ============================================================
-- Add compound index for debt balance queries (analytics)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_debts_company_created_at
  ON public.debts (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_company_date
  ON public.payments (company_id, payment_date DESC);

-- ============================================================
-- Normalize reference_number format trigger
-- Ensures all reference numbers are uppercase
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_reference_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.reference_number := UPPER(TRIM(NEW.reference_number));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_ref_trigger ON public.debts;
CREATE TRIGGER normalize_ref_trigger
  BEFORE INSERT ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.normalize_reference_number();

COMMIT;
