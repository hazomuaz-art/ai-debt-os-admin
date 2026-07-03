-- Security hardening (audit 2026-07-03): these SECURITY DEFINER functions
-- perform privileged operations with NO internal caller verification, and
-- were executable by any signed-in user (and some by anon) directly via
-- /rest/v1/rpc/. The app only ever invokes them server-side through the
-- service-role client, which is unaffected by these revokes.
--   - delete_customer_fully: wipes a customer + ALL their data (~25 tables)
--     for ANY customer id in ANY company — critical cross-tenant hole.
--   - suspend_company / activate_company: platform-owner-only operations.
--   - get_company_limits: leaks any company's plan limits by id.
--   - handle_new_user: auth trigger function, never meant to be called via API.
--   - reset_daily_message_counters: maintenance function, no app RPC caller.
revoke execute on function public.delete_customer_fully(uuid) from anon, authenticated;
revoke execute on function public.suspend_company(uuid, uuid, text) from anon, authenticated;
revoke execute on function public.activate_company(uuid, uuid) from anon, authenticated;
revoke execute on function public.get_company_limits(uuid) from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;
revoke execute on function public.reset_daily_message_counters() from anon, authenticated;
