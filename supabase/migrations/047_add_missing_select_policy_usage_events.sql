-- Bug fix (audit 2026-07-03): usage_events has RLS enabled but ZERO
-- policies exist (RLS-enabled + no policy = deny-all to anon/authenticated).
-- Table has real rows, but src/app/dashboard/admin/platform/page.tsx reads
-- it via the RLS-scoped client (not service role) to show daily/monthly
-- usage counters — every count has always silently returned 0 for every
-- company. Adding the same company-scoped SELECT policy already used on
-- every comparable table (tenant_usage, ai_cost_log, etc).
create policy "usage_events_select" on public.usage_events
  for select using (company_id = get_user_company_id());
