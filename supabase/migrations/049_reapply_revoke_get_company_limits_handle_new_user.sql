BEGIN;

-- Follow-up to 046: a live audit (2026-07-04) found get_company_limits and
-- handle_new_user were STILL executable by anon/authenticated despite 046
-- supposedly revoking them (verified directly via has_function_privilege,
-- not assumed from the migration ledger) — while the other 4 functions
-- targeted in 046 (delete_customer_fully, suspend_company, activate_company,
-- reset_daily_message_counters) were correctly revoked. Re-applying
-- idempotently and this time verifying immediately after via SQL, not just
-- trusting the migration ran. get_company_limits is the real, exploitable
-- risk (returns real plan-limit data for any company_id passed in);
-- handle_new_user is a trigger function (return type 'trigger') so direct
-- RPC invocation already fails at the Postgres level regardless of grants —
-- this revoke is defense-in-depth for it, not closing a live exploit.
revoke execute on function public.get_company_limits(uuid) from anon, authenticated;
revoke execute on function public.handle_new_user() from anon, authenticated;

COMMIT;
