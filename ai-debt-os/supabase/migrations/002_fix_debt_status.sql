-- Migration 002: Normalize debt status values and add missing fields

-- Drop old constraint and add updated one with consistent values
ALTER TABLE public.debts 
  DROP CONSTRAINT IF EXISTS debts_status_check;

ALTER TABLE public.debts
  ADD CONSTRAINT debts_status_check CHECK (
    status IN (
      'active',         -- open, being worked
      'in_progress',    -- collector actively engaged
      'promised',       -- customer promised payment
      'partial',        -- partial payment received
      'in_negotiation', -- payment plan being discussed
      'payment_plan',   -- agreed payment plan in place
      'settled',        -- fully paid
      'written_off',    -- bad debt
      'legal',          -- sent to legal
      'disputed'        -- customer disputes debt
    )
  );

-- Add description column if missing
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS description TEXT;

-- Add customer_id to debts if not present (some migrations may have missed it)
-- (it should be there from migration 001 — this is a safety check via IF NOT EXISTS)
ALTER TABLE public.debts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

-- Update RLS policies to also account for new statuses (no change needed — they're text-based)
