BEGIN;

-- Root cause of 046/049 not taking effect: `pg_proc.proacl` showed
-- get_company_limits and handle_new_user each carry an explicit PUBLIC grant
-- (the bare "=X/postgres" ACL entry) left over from their original CREATE
-- FUNCTION (Postgres grants EXECUTE to PUBLIC by default unless the creator
-- revokes it). REVOKE ... FROM anon, authenticated never touches a PUBLIC
-- grant — Postgres computes effective privilege as "role's own grant OR
-- PUBLIC's grant", so anon/authenticated kept executing via PUBLIC even
-- after being individually revoked twice. The other 4 functions from
-- migration 046 never had a PUBLIC grant to begin with, which is why only
-- these two silently kept working. Revoking from PUBLIC directly this time.
-- A full sweep of every PUBLIC-executable function in the public schema
-- confirmed no other SECURITY DEFINER function has this same gap (the
-- remainder are pgvector extension internals, trigger-only functions whose
-- return type makes direct RPC invocation fail regardless of grants, or
-- get_user_company_id/get_user_role — the two low-risk self-service RLS
-- helpers already knowingly left public in 046).
revoke execute on function public.get_company_limits(uuid) from public;
revoke execute on function public.handle_new_user() from public;
-- Explicit re-grant to the only roles that should ever call these directly.
grant execute on function public.get_company_limits(uuid) to service_role;
grant execute on function public.handle_new_user() to service_role;

COMMIT;
