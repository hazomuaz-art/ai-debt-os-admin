-- ============================================================
-- MIGRATION 052: Prevent duplicate campaign_send_queue rows per recipient
--
-- Real production bug: campaign_recipients already had
-- UNIQUE(campaign_id, customer_id, debt_id), but campaign_send_queue had NO
-- equivalent constraint. Running the campaign builder twice for the same
-- campaign (a re-click, or "تشغيل الحملة" followed by "استهداف عملاء
-- (Excel)" targeting the same person) inserted a SECOND queue row for the
-- same recipient — each one gets picked up and sent independently by
-- send-campaign-queue, so the customer receives the same campaign message
-- more than once. Confirmed live: one customer received 3 near-simultaneous
-- sends from a single campaign run before this fix.
--
-- Each campaign_recipients row should map to at most one send-queue entry —
-- retries already reuse the SAME row (attempts/status columns), never
-- create a new one — so recipient_id is the correct uniqueness key.
-- ============================================================

BEGIN;

-- Dedupe existing rows first (keep the earliest queue row per recipient;
-- the constraint below would fail to apply otherwise).
DELETE FROM public.campaign_send_queue a
USING public.campaign_send_queue b
WHERE a.recipient_id = b.recipient_id
  AND a.id <> b.id
  AND a.created_at > b.created_at;

ALTER TABLE public.campaign_send_queue
  ADD CONSTRAINT campaign_send_queue_recipient_id_key UNIQUE (recipient_id);

COMMIT;
