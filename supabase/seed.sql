-- ============================================================
-- SEED DATA — Development Admin Account + Demo Records
--
-- Creates:
--   Email:    admin@aidebtos.com
--   Password: admin123456
--   Role:     admin
--   Company:  AI Debt OS Demo
--
-- Run this in: Supabase Dashboard → SQL Editor
-- IDEMPOTENT — safe to run multiple times.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Demo Company
-- ============================================================

INSERT INTO public.companies (id, name, slug, plan, is_active, settings)
VALUES (
  'aaaaaaaa-0000-4000-8000-000000000001',
  'AI Debt OS Demo',
  'ai-debt-os-demo',
  'growth',
  true,
  '{"currency":"SAR","timezone":"Asia/Riyadh","language":"en","whatsapp_enabled":true,"ai_scoring_enabled":true}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
  name     = EXCLUDED.name,
  is_active = true;

-- ============================================================
-- 2. Admin auth user
--    bcrypt hash of "admin123456" with cost=10
--    Generated via: echo "admin123456" | htpasswd -niBC 10 admin
-- ============================================================

INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  role,
  aud,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
VALUES (
  'bbbbbbbb-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'admin@aidebtos.com',
  crypt('admin123456', gen_salt('bf', 10)),
  NOW(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Admin User","role":"admin"}'::jsonb,
  'authenticated',
  'authenticated',
  NOW(),
  NOW(),
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO UPDATE SET
  email                = EXCLUDED.email,
  encrypted_password   = EXCLUDED.encrypted_password,
  email_confirmed_at   = EXCLUDED.email_confirmed_at,
  raw_user_meta_data   = EXCLUDED.raw_user_meta_data,
  updated_at           = NOW();

-- Also insert into auth.identities (required for email provider login)
INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  provider,
  identity_data,
  last_sign_in_at,
  created_at,
  updated_at
)
VALUES (
  'cccccccc-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000001',
  'admin@aidebtos.com',
  'email',
  '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","email":"admin@aidebtos.com","email_verified":true}'::jsonb,
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (provider, provider_id) DO UPDATE SET
  identity_data = EXCLUDED.identity_data,
  updated_at    = NOW();

-- ============================================================
-- 3. Admin profile (handle_new_user trigger may have already
--    created a partial row — upsert to ensure correct values)
-- ============================================================

INSERT INTO public.profiles (
  id,
  company_id,
  email,
  full_name,
  role,
  is_active
)
VALUES (
  'bbbbbbbb-0000-4000-8000-000000000001',
  'aaaaaaaa-0000-4000-8000-000000000001',
  'admin@aidebtos.com',
  'Admin User',
  'admin',
  true
)
ON CONFLICT (id) DO UPDATE SET
  company_id = EXCLUDED.company_id,
  email      = EXCLUDED.email,
  full_name  = EXCLUDED.full_name,
  role       = EXCLUDED.role,
  is_active  = true;

-- ============================================================
-- 4. Demo Customers
-- ============================================================

INSERT INTO public.customers (id, company_id, full_name, phone, whatsapp, national_id, city, employer, monthly_income, risk_level)
VALUES
  ('dddd0001-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'Ahmed Al-Rashid',   '+966501234567', '+966501234567', '1234567891', 'Riyadh',  'Saudi Aramco',       25000, 'medium'),
  ('dddd0001-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'Fatima Al-Hassan',  '+966509876543', '+966509876543', '1234567892', 'Jeddah',  'Ministry of Health', 12000, 'low'),
  ('dddd0001-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'Mohammed Al-Otaibi','+966551122334', NULL,            '1234567893', 'Riyadh',  'Freelance',           8000, 'high'),
  ('dddd0001-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'Sara Al-Ghamdi',    '+966567890123', '+966567890123', '1234567894', 'Dammam',  'SABIC',              18000, 'low'),
  ('dddd0001-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'Khalid Al-Shehri',  '+966512345678', NULL,            '1234567895', 'Mecca',   'Unemployed',              0, 'critical')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 5. Demo Debts
-- ============================================================

INSERT INTO public.debts (id, company_id, customer_id, created_by, reference_number, original_amount, current_balance, currency, status, priority, due_date, product_type, account_number)
VALUES
  ('eeee0001-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'dddd0001-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'DEB-DEMO-001', 75000, 62000, 'SAR', 'active',   'high',     (CURRENT_DATE - INTERVAL '45 days')::DATE,  'Personal Loan', 'ACC-001-2024'),
  ('eeee0001-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'dddd0001-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'DEB-DEMO-002', 25000, 25000, 'SAR', 'active',   'medium',   (CURRENT_DATE - INTERVAL '15 days')::DATE,  'Credit Card',   'ACC-002-2024'),
  ('eeee0001-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'dddd0001-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001', 'DEB-DEMO-003', 45000, 45000, 'SAR', 'legal',    'critical', (CURRENT_DATE - INTERVAL '200 days')::DATE, 'Auto Loan',     'ACC-003-2024'),
  ('eeee0001-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000001', 'dddd0001-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001', 'DEB-DEMO-004', 15000,  7500, 'SAR', 'partial',  'medium',   (CURRENT_DATE - INTERVAL '30 days')::DATE,  'Personal Loan', 'ACC-004-2024'),
  ('eeee0001-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000001', 'dddd0001-0000-4000-8000-000000000005', 'bbbbbbbb-0000-4000-8000-000000000001', 'DEB-DEMO-005',120000,120000, 'SAR', 'active',   'critical', (CURRENT_DATE - INTERVAL '120 days')::DATE, 'Mortgage',      'ACC-005-2024'),
  ('eeee0001-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000001', 'dddd0001-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 'DEB-DEMO-006', 30000,     0, 'SAR', 'settled',  'low',      (CURRENT_DATE - INTERVAL '90 days')::DATE,  'Credit Card',   'ACC-006-2024')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 6. Demo Payments
-- ============================================================

INSERT INTO public.payments (id, company_id, debt_id, customer_id, recorded_by, amount, currency, payment_method, payment_date, status)
VALUES
  ('ffff0001-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'eeee0001-0000-4000-8000-000000000001', 'dddd0001-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 13000, 'SAR', 'bank_transfer', (CURRENT_DATE - INTERVAL '20 days')::DATE, 'completed'),
  ('ffff0001-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'eeee0001-0000-4000-8000-000000000004', 'dddd0001-0000-4000-8000-000000000004', 'bbbbbbbb-0000-4000-8000-000000000001',  7500, 'SAR', 'cash',          (CURRENT_DATE - INTERVAL '10 days')::DATE, 'completed'),
  ('ffff0001-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'eeee0001-0000-4000-8000-000000000006', 'dddd0001-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001', 30000, 'SAR', 'bank_transfer', (CURRENT_DATE - INTERVAL '5 days')::DATE,  'completed')
ON CONFLICT (id) DO NOTHING;

-- Update last_payment_date on debts
UPDATE public.debts SET last_payment_date = (CURRENT_DATE - INTERVAL '20 days')::DATE WHERE id = 'eeee0001-0000-4000-8000-000000000001';
UPDATE public.debts SET last_payment_date = (CURRENT_DATE - INTERVAL '10 days')::DATE WHERE id = 'eeee0001-0000-4000-8000-000000000004';
UPDATE public.debts SET last_payment_date = (CURRENT_DATE - INTERVAL '5 days')::DATE  WHERE id = 'eeee0001-0000-4000-8000-000000000006';

-- ============================================================
-- 7. Demo AI Scores
-- ============================================================

INSERT INTO public.ai_scores (id, company_id, debt_id, customer_id, score, risk_classification, collection_probability, recommended_strategy, factors)
VALUES
  ('gggg0001-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', 'eeee0001-0000-4000-8000-000000000001', 'dddd0001-0000-4000-8000-000000000001', 72, 'medium',   0.65, 'Direct negotiation with structured payment plan', '[{"name":"Payment history","impact":"positive","weight":8,"description":"1 payment made"},{"name":"Days overdue","impact":"negative","weight":5,"description":"45 days"},{"name":"Income ratio","impact":"positive","weight":7,"description":"Good DTI"}]'::jsonb),
  ('gggg0001-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'eeee0001-0000-4000-8000-000000000003', 'dddd0001-0000-4000-8000-000000000003', 18, 'critical', 0.12, 'Immediate legal escalation required',             '[{"name":"Days overdue","impact":"negative","weight":10,"description":"200+ days"},{"name":"No payments","impact":"negative","weight":9,"description":"Zero history"},{"name":"Low income","impact":"negative","weight":7,"description":"Unstable income"}]'::jsonb),
  ('gggg0001-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', 'eeee0001-0000-4000-8000-000000000005', 'dddd0001-0000-4000-8000-000000000005', 12, 'critical', 0.08, 'Urgent intervention — large balance, no income',  '[{"name":"Balance","impact":"negative","weight":9,"description":"SAR 120k outstanding"},{"name":"No income","impact":"negative","weight":10,"description":"Unemployed"},{"name":"Days overdue","impact":"negative","weight":8,"description":"120 days"}]'::jsonb)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- ============================================================
-- RESULT
-- ============================================================
-- Admin account ready:
--   URL:      /login
--   Email:    admin@aidebtos.com
--   Password: admin123456
--   Redirects to: /dashboard/admin
-- ============================================================
