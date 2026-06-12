-- MIGRATION 021: Evolution API WhatsApp Channels + n8n Integration
-- Supports multi-instance WhatsApp via Evolution API

-- 1) Evolution API instances (one per portfolio)
CREATE TABLE IF NOT EXISTS public.evolution_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  portfolio_id UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  instance_name TEXT NOT NULL,
  display_name TEXT,
  phone_number TEXT,
  api_url TEXT NOT NULL,              -- Evolution API base URL (e.g. https://evo.yourdomain.com)
  api_key TEXT NOT NULL,              -- Instance API key
  status TEXT DEFAULT 'disconnected'  -- connected, disconnected, qr_pending, banned
    CHECK (status IN ('connected', 'disconnected', 'qr_pending', 'banned')),
  daily_limit INTEGER DEFAULT 500,
  messages_sent_today INTEGER DEFAULT 0,
  last_connected_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  webhook_url TEXT,                   -- n8n webhook URL for this instance
  config JSONB DEFAULT '{}'::jsonb,   -- rate limits, templates, etc
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, instance_name)
);

CREATE INDEX idx_evo_instances_company ON public.evolution_instances(company_id);
CREATE INDEX idx_evo_instances_portfolio ON public.evolution_instances(portfolio_id);
CREATE INDEX idx_evo_instances_status ON public.evolution_instances(status) WHERE status = 'connected';

-- 2) n8n workflow registry (track active workflows)
CREATE TABLE IF NOT EXISTS public.n8n_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  workflow_name TEXT NOT NULL,        -- human-readable name
  workflow_type TEXT NOT NULL,        -- whatsapp_inbound, whatsapp_outbound, collection_sync, promise_followup, campaign_executor
  n8n_workflow_id TEXT,               -- n8n internal workflow ID
  webhook_url TEXT,                   -- webhook trigger URL
  is_active BOOLEAN DEFAULT true,
  last_executed_at TIMESTAMPTZ,
  execution_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  last_error TEXT,
  config JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, workflow_type)
);

-- 3) Customer Memory v2 with Vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.customer_memory_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL           -- personality, strategy, objection, promise_history, interaction_summary, preference
    CHECK (memory_type IN ('personality', 'strategy', 'objection', 'promise_history', 'interaction_summary', 'preference', 'note')),
  content TEXT NOT NULL,
  importance NUMERIC(3,1) DEFAULT 5.0 CHECK (importance BETWEEN 1 AND 10),
  embedding VECTOR(1536),            -- OpenAI text-embedding-3-small
  source TEXT DEFAULT 'ai',          -- ai, human, system
  metadata JSONB DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,            -- optional expiry
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_customer_memory_v2_customer ON public.customer_memory_v2(company_id, customer_id);
CREATE INDEX idx_customer_memory_v2_type ON public.customer_memory_v2(memory_type);
CREATE INDEX idx_customer_memory_v2_importance ON public.customer_memory_v2(importance DESC);

-- 4) Disputes table (if not exists from previous migrations)
CREATE TABLE IF NOT EXISTS public.disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id UUID REFERENCES public.debts(id) ON DELETE SET NULL,
  dispute_type TEXT NOT NULL
    CHECK (dispute_type IN ('amount_wrong', 'already_paid', 'not_my_debt', 'service_issue', 'other')),
  description TEXT NOT NULL,
  status TEXT DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'resolved', 'rejected', 'escalated')),
  priority TEXT DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  assigned_to UUID REFERENCES public.profiles(id),
  resolution TEXT,
  resolved_by UUID REFERENCES public.profiles(id),
  resolved_at TIMESTAMPTZ,
  source TEXT DEFAULT 'ai',          -- ai, customer, human
  conversation_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_disputes_company ON public.disputes(company_id);
CREATE INDEX IF NOT EXISTS idx_disputes_customer ON public.disputes(customer_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON public.disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_debt ON public.disputes(debt_id);

-- 5) Enable RLS
ALTER TABLE public.evolution_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.n8n_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_memory_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;

-- 6) RLS Policies
DO $$
BEGIN
  -- Evolution instances
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='evolution_instances' AND policyname='evo_instances_company') THEN
    CREATE POLICY evo_instances_company ON public.evolution_instances
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  -- n8n workflows
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='n8n_workflows' AND policyname='n8n_workflows_company') THEN
    CREATE POLICY n8n_workflows_company ON public.n8n_workflows
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  -- Customer memory
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='customer_memory_v2' AND policyname='customer_memory_v2_company') THEN
    CREATE POLICY customer_memory_v2_company ON public.customer_memory_v2
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;

  -- Disputes
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='disputes' AND policyname='disputes_company') THEN
    CREATE POLICY disputes_company ON public.disputes
      USING (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()))
      WITH CHECK (company_id IN (SELECT company_id FROM public.profiles WHERE id = auth.uid()));
  END IF;
END $$;

-- 7) Reset daily message counters (run via pg_cron or n8n schedule)
CREATE OR REPLACE FUNCTION public.reset_daily_message_counters()
RETURNS void AS $$
BEGIN
  UPDATE public.evolution_instances SET messages_sent_today = 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8) Updated_at triggers
CREATE TRIGGER evolution_instances_updated_at BEFORE UPDATE ON public.evolution_instances
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER n8n_workflows_updated_at BEFORE UPDATE ON public.n8n_workflows
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER customer_memory_v2_updated_at BEFORE UPDATE ON public.customer_memory_v2
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER disputes_updated_at BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
