BEGIN;

-- AI Revenue Attribution: collection_attribution gains event-type tagging
-- and idempotency anchors so a promise/payment/settlement/dispute event
-- can never be duplicated by a retried webhook call.

alter table collection_attribution
  add column if not exists supporting_actor text,
  add column if not exists event_type text not null default 'payment',
  add column if not exists source_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'collection_attribution_event_type_check') then
    alter table collection_attribution
      add constraint collection_attribution_event_type_check
      check (event_type in ('promise','payment','settlement','dispute','escalation'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'collection_attribution_supporting_actor_check') then
    alter table collection_attribution
      add constraint collection_attribution_supporting_actor_check
      check (supporting_actor is null or supporting_actor in ('ai','collector','ai_assisted','campaign','customer','unknown'));
  end if;
end $$;

-- Idempotency: one attribution row per real payment, per promise/dispute
-- source record, and per debt settlement.
create unique index if not exists uq_collection_attribution_payment
  on collection_attribution(payment_id) where payment_id is not null;
create unique index if not exists uq_collection_attribution_source
  on collection_attribution(source_id) where source_id is not null;
create unique index if not exists uq_collection_attribution_settlement
  on collection_attribution(debt_id) where event_type = 'settlement';

COMMIT;
