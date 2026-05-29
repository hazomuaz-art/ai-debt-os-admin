-- ============================================================
-- AI DEBT OPERATING SYSTEM — Full Database Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- COMPANIES (Tenants)
-- ============================================================
CREATE TABLE public.companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'growth', 'enterprise')),
  settings JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  role TEXT NOT NULL DEFAULT 'collector' CHECK (role IN ('admin', 'manager', 'collector')),
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CUSTOMERS (Debtors)
-- ============================================================
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  whatsapp TEXT,
  national_id TEXT,
  address TEXT,
  city TEXT,
  country TEXT DEFAULT 'SA',
  date_of_birth DATE,
  employer TEXT,
  monthly_income DECIMAL(15,2),
  credit_score INTEGER CHECK (credit_score BETWEEN 0 AND 1000),
  risk_level TEXT DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DEBTS
-- ============================================================
CREATE TABLE public.debts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES public.profiles(id),
  reference_number TEXT NOT NULL,
  original_amount DECIMAL(15,2) NOT NULL CHECK (original_amount > 0),
  current_balance DECIMAL(15,2) NOT NULL,
  interest_rate DECIMAL(5,2) DEFAULT 0,
  penalty_amount DECIMAL(15,2) DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'SAR',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'in_progress', 'promised', 'partial', 'settled', 'written_off', 'legal', 'disputed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  due_date DATE,
  last_payment_date DATE,
  next_follow_up DATE,
  product_type TEXT,
  creditor_name TEXT,
  account_number TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure unique reference per company
ALTER TABLE public.debts ADD CONSTRAINT debts_reference_company_unique UNIQUE (company_id, reference_number);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  debt_id UUID NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  recorded_by UUID REFERENCES public.profiles(id),
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'SAR',
  payment_method TEXT CHECK (payment_method IN ('cash', 'bank_transfer', 'card', 'check', 'online', 'other')),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_number TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed', 'reversed')),
  notes TEXT,
  receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- MESSAGES / COMMUNICATIONS
-- ============================================================
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  debt_id UUID REFERENCES public.debts(id),
  sent_by UUID REFERENCES public.profiles(id),
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'sms', 'email', 'call', 'internal')),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed')),
  whatsapp_message_id TEXT,
  whatsapp_status TEXT,
  metadata JSONB DEFAULT '{}',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AI SCORES
-- ============================================================
CREATE TABLE public.ai_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  debt_id UUID NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  risk_classification TEXT NOT NULL CHECK (risk_classification IN ('low', 'medium', 'high', 'critical')),
  collection_probability DECIMAL(5,2),
  recommended_strategy TEXT,
  priority_rank INTEGER,
  factors JSONB DEFAULT '[]',
  raw_response TEXT,
  model_version TEXT DEFAULT 'gpt-4',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- AI ACTIONS (Daily Action Plans)
-- ============================================================
CREATE TABLE public.ai_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  debt_id UUID NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  assigned_to UUID REFERENCES public.profiles(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('call', 'whatsapp', 'email', 'visit', 'legal', 'escalate', 'settle')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  reason TEXT NOT NULL,
  suggested_message TEXT,
  best_time_to_contact TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped', 'rescheduled')),
  scheduled_for DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- ACTIVITY LOGS
-- ============================================================
CREATE TABLE public.logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.profiles(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('debt', 'customer', 'payment', 'message', 'ai_action', 'user', 'company')),
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_profiles_company ON public.profiles(company_id);
CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_customers_company ON public.customers(company_id);
CREATE INDEX idx_customers_phone ON public.customers(phone);
CREATE INDEX idx_debts_company ON public.debts(company_id);
CREATE INDEX idx_debts_customer ON public.debts(customer_id);
CREATE INDEX idx_debts_assigned ON public.debts(assigned_to);
CREATE INDEX idx_debts_status ON public.debts(status);
CREATE INDEX idx_debts_priority ON public.debts(priority);
CREATE INDEX idx_payments_debt ON public.payments(debt_id);
CREATE INDEX idx_payments_customer ON public.payments(customer_id);
CREATE INDEX idx_messages_customer ON public.messages(customer_id);
CREATE INDEX idx_messages_company ON public.messages(company_id);
CREATE INDEX idx_ai_scores_debt ON public.ai_scores(debt_id);
CREATE INDEX idx_ai_actions_assigned ON public.ai_actions(assigned_to);
CREATE INDEX idx_ai_actions_scheduled ON public.ai_actions(scheduled_for);
CREATE INDEX idx_logs_entity ON public.logs(entity_type, entity_id);
CREATE INDEX idx_logs_user ON public.logs(user_id);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER debts_updated_at BEFORE UPDATE ON public.debts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER ai_actions_updated_at BEFORE UPDATE ON public.ai_actions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- HANDLE NEW USER (auto-create profile)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    COALESCE(NEW.raw_user_meta_data->>'role', 'collector')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- Helper: get current user's company_id
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- COMPANIES: users can view their own company
CREATE POLICY "Users view own company" ON public.companies
  FOR SELECT USING (id = public.get_user_company_id());

CREATE POLICY "Admins update company" ON public.companies
  FOR UPDATE USING (id = public.get_user_company_id() AND public.get_user_role() = 'admin');

-- PROFILES: company-scoped
CREATE POLICY "View profiles in company" ON public.profiles
  FOR SELECT USING (company_id = public.get_user_company_id());

CREATE POLICY "Update own profile" ON public.profiles
  FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Admin manage profiles" ON public.profiles
  FOR ALL USING (company_id = public.get_user_company_id() AND public.get_user_role() = 'admin');

-- CUSTOMERS: company-scoped, collectors see only assigned customer debts
CREATE POLICY "View customers in company" ON public.customers
  FOR SELECT USING (company_id = public.get_user_company_id());

CREATE POLICY "Managers and admins create customers" ON public.customers
  FOR INSERT WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.get_user_role() IN ('admin', 'manager', 'collector')
  );

CREATE POLICY "Managers and admins update customers" ON public.customers
  FOR UPDATE USING (company_id = public.get_user_company_id());

-- DEBTS: company-scoped, collectors see only assigned debts
CREATE POLICY "Admins and managers view all debts" ON public.debts
  FOR SELECT USING (
    company_id = public.get_user_company_id()
    AND (
      public.get_user_role() IN ('admin', 'manager')
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "Create debts" ON public.debts
  FOR INSERT WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "Update debts" ON public.debts
  FOR UPDATE USING (
    company_id = public.get_user_company_id()
    AND (
      public.get_user_role() IN ('admin', 'manager')
      OR assigned_to = auth.uid()
    )
  );

-- PAYMENTS: company-scoped
CREATE POLICY "View payments in company" ON public.payments
  FOR SELECT USING (company_id = public.get_user_company_id());

CREATE POLICY "Create payments" ON public.payments
  FOR INSERT WITH CHECK (company_id = public.get_user_company_id());

-- MESSAGES: company-scoped
CREATE POLICY "View messages in company" ON public.messages
  FOR SELECT USING (company_id = public.get_user_company_id());

CREATE POLICY "Create messages" ON public.messages
  FOR INSERT WITH CHECK (company_id = public.get_user_company_id());

-- AI_SCORES: company-scoped
CREATE POLICY "View AI scores in company" ON public.ai_scores
  FOR SELECT USING (company_id = public.get_user_company_id());

CREATE POLICY "Insert AI scores" ON public.ai_scores
  FOR INSERT WITH CHECK (company_id = public.get_user_company_id());

-- AI_ACTIONS: company-scoped, collectors see assigned
CREATE POLICY "View AI actions" ON public.ai_actions
  FOR SELECT USING (
    company_id = public.get_user_company_id()
    AND (
      public.get_user_role() IN ('admin', 'manager')
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "Create AI actions" ON public.ai_actions
  FOR INSERT WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "Update AI actions" ON public.ai_actions
  FOR UPDATE USING (
    company_id = public.get_user_company_id()
    AND (
      public.get_user_role() IN ('admin', 'manager')
      OR assigned_to = auth.uid()
    )
  );

-- LOGS: company-scoped, read-only for users
CREATE POLICY "View logs in company" ON public.logs
  FOR SELECT USING (company_id = public.get_user_company_id());

CREATE POLICY "Insert logs" ON public.logs
  FOR INSERT WITH CHECK (company_id = public.get_user_company_id());

-- ============================================================
-- SEED: Demo company (optional for testing)
-- ============================================================
-- INSERT INTO public.companies (name, slug, plan) VALUES ('Demo Corp', 'demo-corp', 'growth');
