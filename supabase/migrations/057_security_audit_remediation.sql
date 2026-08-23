BEGIN;

-- Direct Supabase sign-up, if accidentally re-enabled at the provider, must
-- not create an active or privileged application profile. Trusted admin
-- provisioning explicitly assigns company/role/is_active after user creation.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name', 'collector', false);
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- F-03: inbound/unknown contacts must be tenant-scoped. Legacy rows that can
-- be associated safely inherit the matched customer's company; unresolved
-- legacy rows remain quarantined (NULL) and are ignored by the new code.
ALTER TABLE public.unmatched_contacts
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE;

UPDATE public.unmatched_contacts AS unmatched
SET company_id = customer.company_id
FROM public.customers AS customer
WHERE unmatched.company_id IS NULL
  AND unmatched.matched_customer_id = customer.id;

ALTER TABLE public.unmatched_contacts DROP CONSTRAINT IF EXISTS unmatched_contacts_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS unmatched_contacts_company_phone_unique
  ON public.unmatched_contacts(company_id, phone)
  WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS unmatched_contacts_company_status_idx
  ON public.unmatched_contacts(company_id, status, updated_at DESC);

-- The application links a newly self-identified number using this source.
ALTER TABLE public.customer_contacts DROP CONSTRAINT IF EXISTS customer_contacts_source_check;
ALTER TABLE public.customer_contacts ADD CONSTRAINT customer_contacts_source_check
  CHECK (source IN ('import', 'manual', 'inbound_self_identified'));

-- F-06: integration credentials/configuration are admin-only even for SELECT.
DROP POLICY IF EXISTS integrations_select ON public.integration_settings;
CREATE POLICY integrations_select ON public.integration_settings
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_user_company_id()
    AND public.get_user_role() = 'admin'
  );

-- F-07: align the database contract with the integration names exposed by UI.
ALTER TABLE public.integration_settings
  DROP CONSTRAINT IF EXISTS integration_settings_integration_name_check;
ALTER TABLE public.integration_settings
  ADD CONSTRAINT integration_settings_integration_name_check
  CHECK (integration_name IN (
    'waha', 'n8n_automation', 'collection_api', 'tameez_calls', 'rasf_whatsapp'
  ));

-- F-01: outbound AI voice is not implemented. Keep it unavailable in plans
-- until a real dialer/provider, consent controls, and end-to-end tests exist.
UPDATE public.billing_plans
SET feature_voice = false,
    voice_minutes_month = 0,
    limits = jsonb_set(COALESCE(limits, '{}'::jsonb), '{voice_minutes}', '0'::jsonb, true);

COMMIT;
