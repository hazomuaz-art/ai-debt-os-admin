-- ============================================================
-- MIGRATION 053: Close two race-condition gaps + one RLS role gap
--
-- 1) disputes: no constraint stopped two concurrent inbound WhatsApp
--    messages from both being classified as a dispute before either insert
--    committed, creating two open dispute rows for the same debt. The app
--    dedup in src/lib/dispute.ts is the only current protection and is not
--    atomic. A partial unique index enforces "at most one non-terminal
--    dispute per debt" at the database level — resolved/rejected disputes
--    for the same debt are unaffected (a NEW dispute can still be opened
--    later once the prior one is closed).
--
-- 2) promises: same class of race for two inbound messages both parsed as
--    the exact same promise (same debt/date/amount) — nothing stopped two
--    identical pending rows, which would double the follow-up reminders a
--    customer receives. Partial unique index on the exact duplicate shape
--    only; genuinely different pending promises for the same debt (e.g. a
--    revised date) are unaffected.
--
-- 3) campaign_send_queue_write RLS policy checked company_id only, unlike
--    campaign_recipients_write and portfolio_whatsapp_numbers_write which
--    both also require admin/manager role — any authenticated user of a
--    company could write directly to the send queue via the client-scoped
--    Supabase client. Both application entry points that build this queue
--    (campaign-builder and upload-targets routes) already require
--    admin/manager; this closes the same gap at the RLS layer for
--    consistency/defense-in-depth.
-- ============================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_disputes_one_open_per_debt
  ON public.disputes (debt_id)
  WHERE status IN ('open', 'under_review');

CREATE UNIQUE INDEX IF NOT EXISTS idx_promises_no_exact_duplicate_pending
  ON public.promises (debt_id, promised_date, promised_amount)
  WHERE status = 'pending';

DROP POLICY IF EXISTS "campaign_send_queue_write" ON public.campaign_send_queue;
CREATE POLICY "campaign_send_queue_write" ON public.campaign_send_queue
  FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
  WITH CHECK (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'));

COMMIT;
