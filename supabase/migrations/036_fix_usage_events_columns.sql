-- Fixes a real production bug: two earlier migrations (015 and 016) both
-- did `CREATE TABLE IF NOT EXISTS public.usage_events` with DIFFERENT
-- schemas. Whichever ran first won; the live table ended up with 016's
-- bare-bones shape (id, company_id, event_type, metadata, created_at) while
-- src/lib/usage-tracker.ts has always inserted user_id/debt_id/customer_id/
-- cost_usd too. Every single usage_events insert has been failing silently
-- (PGRST204, swallowed as a log.warn) since this feature was deployed —
-- meaning SaaS plan-limit usage tracking has never actually recorded
-- anything. This migration adds the missing columns additively; no data
-- loss, no rewrite of existing rows.
BEGIN;

ALTER TABLE public.usage_events
  ADD COLUMN IF NOT EXISTS user_id     UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS debt_id     UUID REFERENCES public.debts(id),
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id),
  ADD COLUMN IF NOT EXISTS cost_usd    DECIMAL(10,6) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_usage_events_company_created
  ON public.usage_events (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_events_company_type
  ON public.usage_events (company_id, event_type, created_at DESC);

COMMIT;
