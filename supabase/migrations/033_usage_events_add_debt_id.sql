-- usage_events.trackEvent() (src/lib/usage-tracker.ts) has always sent a
-- debt_id, but the column was never added to the table — causing repeated
-- PGRST204 "Could not find the 'debt_id' column" errors in production.
-- Nullable + FK with ON DELETE SET NULL so it never blocks a debt deletion
-- and never breaks existing rows (all current rows simply get debt_id = NULL).

alter table usage_events
  add column if not exists debt_id uuid references debts(id) on delete set null;

create index if not exists idx_usage_events_debt_id
  on usage_events (debt_id)
  where debt_id is not null;
