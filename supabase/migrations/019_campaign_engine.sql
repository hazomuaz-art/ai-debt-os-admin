-- ============================================================
-- MIGRATION 019: Campaign Engine
-- Adds portfolio WhatsApp numbers, campaign recipients, send queue
-- ============================================================

BEGIN;

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES public.portfolios(id),
  ADD COLUMN IF NOT EXISTS daily_limit INTEGER DEFAULT 250,
  ADD COLUMN IF NOT EXISTS send_window_start TIME DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS send_window_end TIME DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS min_delay_seconds INTEGER DEFAULT 30,
  ADD COLUMN IF NOT EXISTS max_delay_seconds INTEGER DEFAULT 90,
  ADD COLUMN IF NOT EXISTS stop_rules JSONB DEFAULT '{
    "stop_on_reply": true,
    "stop_on_payment_claim": true,
    "stop_on_dispute": true,
    "stop_on_open_promise": true,
    "stop_on_installment_request": true
  }';

CREATE TABLE IF NOT EXISTS public.portfolio_whatsapp_numbers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID NOT NULL REFERENCES public.portfolios(id) ON DELETE CASCADE,
  display_name TEXT,
  phone_number TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'evolution',
  instance_name TEXT NOT NULL,
  api_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  daily_limit INTEGER DEFAULT 250,
  sent_today INTEGER DEFAULT 0,
  last_sent_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(company_id, phone_number),
  UNIQUE(company_id, portfolio_id, instance_name)
);

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id UUID REFERENCES public.debts(id) ON DELETE SET NULL,
  whatsapp_number_id UUID REFERENCES public.portfolio_whatsapp_numbers(id),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','queued','sent','delivered','replied','stopped','failed','completed')),
  stop_reason TEXT,
  priority INTEGER DEFAULT 50,
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  last_message TEXT,
  last_error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(campaign_id, customer_id, debt_id)
);

CREATE TABLE IF NOT EXISTS public.campaign_send_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  recipient_id UUID NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id),
  whatsapp_number_id UUID REFERENCES public.portfolio_whatsapp_numbers(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id UUID REFERENCES public.debts(id) ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed','cancelled','skipped')),
  message_text TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.portfolio_whatsapp_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_send_queue ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='portfolio_whatsapp_numbers' AND policyname='portfolio_whatsapp_numbers_select') THEN
    CREATE POLICY "portfolio_whatsapp_numbers_select" ON public.portfolio_whatsapp_numbers
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "portfolio_whatsapp_numbers_write" ON public.portfolio_whatsapp_numbers
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='campaign_recipients' AND policyname='campaign_recipients_select') THEN
    CREATE POLICY "campaign_recipients_select" ON public.campaign_recipients
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "campaign_recipients_write" ON public.campaign_recipients
      FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() IN ('admin','manager'))
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='campaign_send_queue' AND policyname='campaign_send_queue_select') THEN
    CREATE POLICY "campaign_send_queue_select" ON public.campaign_send_queue
      FOR SELECT USING (company_id = public.get_user_company_id());
    CREATE POLICY "campaign_send_queue_write" ON public.campaign_send_queue
      FOR ALL USING (company_id = public.get_user_company_id())
      WITH CHECK (company_id = public.get_user_company_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_campaigns_portfolio ON public.campaigns(company_id, portfolio_id, status);
CREATE INDEX IF NOT EXISTS idx_portfolio_whatsapp_active ON public.portfolio_whatsapp_numbers(company_id, portfolio_id, is_active);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status ON public.campaign_recipients(company_id, campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_campaign_queue_pending ON public.campaign_send_queue(company_id, status, scheduled_at) WHERE status = 'pending';

COMMIT;
