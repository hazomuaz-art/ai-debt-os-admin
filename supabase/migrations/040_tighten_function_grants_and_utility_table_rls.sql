BEGIN;

REVOKE EXECUTE ON FUNCTION public.delete_customer_fully(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.suspend_company(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.activate_company(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_daily_message_counters() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.delete_customer_fully(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.suspend_company(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.activate_company(uuid, uuid) TO authenticated;

ALTER TABLE public._migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._backup_tier1_2026_06_22 ENABLE ROW LEVEL SECURITY;

COMMIT;
