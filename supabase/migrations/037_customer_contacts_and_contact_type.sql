-- Adds support for: (1) multiple phone numbers per customer (the imported
-- file's primary phone stays exactly where it always was — customers.phone/
-- customers.whatsapp — this table is purely additive), and (2) a contact_type
-- flag to drive channel preference (individual -> WhatsApp, company -> email,
-- once the email provider is wired up). Neither change touches or renames
-- any existing column.
BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  label       TEXT,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  status      TEXT NOT NULL DEFAULT 'untried'
              CHECK (status IN ('untried', 'delivered', 'no_reply', 'wrong_number')),
  source      TEXT NOT NULL DEFAULT 'import' CHECK (source IN ('import', 'manual')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (customer_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_customer_contacts_customer ON public.customer_contacts (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_contacts_company ON public.customer_contacts (company_id);

ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'customer_contacts' AND policyname = 'cc_company_isolation'
  ) THEN
    CREATE POLICY "cc_company_isolation" ON public.customer_contacts
      FOR ALL USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
END $$;

CREATE POLICY "cc_service_role" ON public.customer_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS contact_type TEXT NOT NULL DEFAULT 'individual'
    CHECK (contact_type IN ('individual', 'company'));

COMMIT;
