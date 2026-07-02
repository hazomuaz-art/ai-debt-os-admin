-- ═══════════════════════════════════════════════════════════════
-- 1) Tables with RLS fully disabled — enable + scope by company_id
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.collection_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ca_select ON public.collection_accounts FOR SELECT
  USING (company_id = get_user_company_id());
CREATE POLICY ca_write ON public.collection_accounts FOR ALL
  USING (company_id = get_user_company_id() AND get_user_role() IN ('admin','manager'))
  WITH CHECK (company_id = get_user_company_id() AND get_user_role() IN ('admin','manager'));

ALTER TABLE public.deleted_customer_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY dca_select ON public.deleted_customer_archive FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() IN ('admin','manager'));

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY ff_select ON public.feature_flags FOR SELECT
  USING (company_id = get_user_company_id());
CREATE POLICY ff_write ON public.feature_flags FOR ALL
  USING (company_id = get_user_company_id() AND get_user_role() = 'admin')
  WITH CHECK (company_id = get_user_company_id() AND get_user_role() = 'admin');

ALTER TABLE public.infra_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ic_select ON public.infra_costs FOR SELECT
  USING (company_id = get_user_company_id() AND get_user_role() = 'admin');

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
-- Deliberately NO policy for authenticated/anon: only the service role (which
-- bypasses RLS) reads/writes raw provider webhook payloads.

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY bp_select ON public.billing_plans FOR SELECT
  USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 2) Reference/temporal tables — RLS enabled, read-only for authenticated
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.temporal_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY th_select ON public.temporal_holidays FOR SELECT USING (true);

ALTER TABLE public.temporal_spelling_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tsv_select ON public.temporal_spelling_variants FOR SELECT USING (true);

ALTER TABLE public.temporal_gov_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tgp_select ON public.temporal_gov_programs FOR SELECT USING (true);

ALTER TABLE public.temporal_country_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tcc_select ON public.temporal_country_config FOR SELECT USING (true);

ALTER TABLE public.temporal_composite_patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tcp_select ON public.temporal_composite_patterns FOR SELECT USING (true);

ALTER TABLE public.temporal_business_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY tbc_select ON public.temporal_business_calendar FOR SELECT USING (true);

ALTER TABLE public.temporal_learning ENABLE ROW LEVEL SECURITY;
CREATE POLICY tl_select ON public.temporal_learning FOR SELECT USING (true);

-- ═══════════════════════════════════════════════════════════════
-- 3) Permissive "USING(true)/WITH CHECK(true)" policies that defeat
--    company isolation despite RLS being "on" — tighten to real company scoping
-- ═══════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS or_insert ON public.orchestrator_runs;
CREATE POLICY or_insert ON public.orchestrator_runs FOR INSERT
  WITH CHECK (company_id = get_user_company_id());

DROP POLICY IF EXISTS po_admin_write ON public.plan_overrides;
CREATE POLICY po_admin_write ON public.plan_overrides FOR ALL
  USING (get_user_role() = 'admin' AND company_id = get_user_company_id())
  WITH CHECK (get_user_role() = 'admin' AND company_id = get_user_company_id());

DROP POLICY IF EXISTS alerts_write ON public.system_alerts;
CREATE POLICY alerts_write ON public.system_alerts FOR ALL
  USING (company_id = get_user_company_id() OR company_id IS NULL)
  WITH CHECK (company_id = get_user_company_id());

DROP POLICY IF EXISTS usage_write ON public.tenant_usage;
CREATE POLICY usage_write ON public.tenant_usage FOR ALL
  USING (company_id = get_user_company_id())
  WITH CHECK (company_id = get_user_company_id());

-- ═══════════════════════════════════════════════════════════════
-- 4) Lock down anon access to sensitive SECURITY DEFINER functions
-- ═══════════════════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.delete_customer_fully FROM anon;
REVOKE EXECUTE ON FUNCTION public.suspend_company FROM anon;
REVOKE EXECUTE ON FUNCTION public.activate_company FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_daily_message_counters FROM anon;
