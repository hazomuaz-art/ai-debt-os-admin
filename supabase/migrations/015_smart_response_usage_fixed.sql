-- SAFE FIXED MIGRATION 015
-- Smart Response Engine + Usage Tracking

BEGIN;

CREATE TABLE IF NOT EXISTS public.response_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_keywords TEXT[] DEFAULT '{}',
  intent_category TEXT DEFAULT 'general',
  response_ar TEXT,
  response_en TEXT,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.response_templates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.response_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  message_hash TEXT NOT NULL,
  input_text TEXT,
  response_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days')
);

ALTER TABLE public.response_cache ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_response_cache_lookup
ON public.response_cache(company_id, message_hash);

CREATE TABLE IF NOT EXISTS public.intent_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  intent TEXT NOT NULL,
  pattern_value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.intent_patterns ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_usage
ADD COLUMN IF NOT EXISTS messages_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS campaigns_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS users_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS customers_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS debts_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_cache_hits INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS ai_openai_calls INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

COMMIT;
