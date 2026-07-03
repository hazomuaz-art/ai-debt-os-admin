-- Security hardening (audit 2026-07-03): these functions have no explicit
-- search_path, meaning it inherits the caller's session search_path — a
-- malicious caller (or role misconfiguration) could shadow an unqualified
-- table/function reference by creating a same-named object earlier in
-- their own search_path. This does not change any function's LOGIC, only
-- pins name resolution to the trusted public schema.
alter function public.handle_updated_at() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.get_user_company_id() set search_path = public;
alter function public.get_user_role() set search_path = public;
alter function public.sync_ai_action_schedule() set search_path = public;
alter function public.touch_integration_settings() set search_path = public;
alter function public.touch_portfolios() set search_path = public;
alter function public.touch_system_config() set search_path = public;
alter function public.touch_company_subscriptions() set search_path = public;
alter function public.reset_daily_message_counters() set search_path = public;
