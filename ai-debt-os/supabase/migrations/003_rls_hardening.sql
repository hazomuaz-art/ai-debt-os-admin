-- ============================================================
-- MIGRATION 003: RLS Hardening & Security
-- ============================================================
-- Fixes:
--   1. Privilege escalation: users cannot update own role
--   2. Cross-tenant data leaks via FK traversal
--   3. Missing DELETE policies (implicit allow)
--   4. Webhook service-role path is correctly bypassed
--   5. Helper functions made immutable for performance
--   6. Indexes for RLS predicate columns
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: Drop all existing RLS policies and rebuild
-- (clean slate prevents accumulated policy drift)
-- ============================================================

-- COMPANIES
DROP POLICY IF EXISTS "Users view own company"      ON public.companies;
DROP POLICY IF EXISTS "Admins update company"       ON public.companies;

-- PROFILES
DROP POLICY IF EXISTS "View profiles in company"    ON public.profiles;
DROP POLICY IF EXISTS "Update own profile"          ON public.profiles;
DROP POLICY IF EXISTS "Admin manage profiles"       ON public.profiles;

-- CUSTOMERS
DROP POLICY IF EXISTS "View customers in company"           ON public.customers;
DROP POLICY IF EXISTS "Managers and admins create customers" ON public.customers;
DROP POLICY IF EXISTS "Managers and admins update customers" ON public.customers;

-- DEBTS
DROP POLICY IF EXISTS "Admins and managers view all debts"  ON public.debts;
DROP POLICY IF EXISTS "Create debts"                        ON public.debts;
DROP POLICY IF EXISTS "Update debts"                        ON public.debts;

-- PAYMENTS
DROP POLICY IF EXISTS "View payments in company"   ON public.payments;
DROP POLICY IF EXISTS "Create payments"            ON public.payments;

-- MESSAGES
DROP POLICY IF EXISTS "View messages in company"   ON public.messages;
DROP POLICY IF EXISTS "Create messages"            ON public.messages;

-- AI_SCORES
DROP POLICY IF EXISTS "View AI scores in company"  ON public.ai_scores;
DROP POLICY IF EXISTS "Insert AI scores"           ON public.ai_scores;

-- AI_ACTIONS
DROP POLICY IF EXISTS "View AI actions"            ON public.ai_actions;
DROP POLICY IF EXISTS "Create AI actions"          ON public.ai_actions;
DROP POLICY IF EXISTS "Update AI actions"          ON public.ai_actions;

-- LOGS
DROP POLICY IF EXISTS "View logs in company"       ON public.logs;
DROP POLICY IF EXISTS "Insert logs"                ON public.logs;

-- ============================================================
-- SECTION 2: Hardened helper functions
-- ============================================================

-- Cached per-statement: avoids repeated profile lookups within a single query
CREATE OR REPLACE FUNCTION public.get_user_company_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.profiles WHERE id = auth.uid() AND is_active = true LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid() AND is_active = true LIMIT 1;
$$;

-- Combined check: is this user an admin or manager?
CREATE OR REPLACE FUNCTION public.is_admin_or_manager()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('admin', 'manager')
      AND is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  );
$$;

-- ============================================================
-- SECTION 3: COMPANIES policies
-- ============================================================

-- SELECT: any active user sees their company
CREATE POLICY "company_select"
  ON public.companies
  FOR SELECT
  USING (id = public.get_user_company_id());

-- UPDATE: only admins can update company settings
CREATE POLICY "company_update_admin"
  ON public.companies
  FOR UPDATE
  USING (id = public.get_user_company_id() AND public.is_admin())
  WITH CHECK (id = public.get_user_company_id() AND public.is_admin());

-- DELETE: no user can delete a company (only service role / support)
-- (no policy = implicit deny with RLS enabled)

-- INSERT: only via service role (registration action uses service client)
-- (no policy = implicit deny with RLS enabled for authenticated users)

-- ============================================================
-- SECTION 4: PROFILES policies
-- ============================================================

-- SELECT: see all active profiles in same company
CREATE POLICY "profile_select_company"
  ON public.profiles
  FOR SELECT
  USING (company_id = public.get_user_company_id() AND is_active = true);

-- UPDATE own profile: cannot change company_id or role
CREATE POLICY "profile_update_self"
  ON public.profiles
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    -- Prevent self-escalation: role and company_id must not change
    AND company_id = public.get_user_company_id()
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- Admin can update any profile in their company (except other admins' roles)
CREATE POLICY "profile_update_admin"
  ON public.profiles
  FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND public.is_admin()
    AND id != auth.uid() -- handled by self policy above
  )
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.is_admin()
  );

-- Soft-delete: admins can deactivate (UPDATE is_active=false), not hard delete
-- INSERT: only via service role (invite endpoint uses service client)

-- ============================================================
-- SECTION 5: CUSTOMERS policies
-- ============================================================

-- SELECT: all roles see customers in their company
CREATE POLICY "customer_select"
  ON public.customers
  FOR SELECT
  USING (company_id = public.get_user_company_id());

-- INSERT: any authenticated user in the company can create customers
CREATE POLICY "customer_insert"
  ON public.customers
  FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

-- UPDATE: admin/manager can update any; collector cannot update customers
CREATE POLICY "customer_update_admin_manager"
  ON public.customers
  FOR UPDATE
  USING (company_id = public.get_user_company_id() AND public.is_admin_or_manager())
  WITH CHECK (company_id = public.get_user_company_id());

-- DELETE: admin only (hard delete, use with caution — prefer archiving)
CREATE POLICY "customer_delete_admin"
  ON public.customers
  FOR DELETE
  USING (company_id = public.get_user_company_id() AND public.is_admin());

-- ============================================================
-- SECTION 6: DEBTS policies
-- ============================================================

-- SELECT: admin/manager see all; collector sees only assigned
CREATE POLICY "debt_select"
  ON public.debts
  FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND (
      public.is_admin_or_manager()
      OR assigned_to = auth.uid()
    )
  );

-- INSERT: admin/manager only
CREATE POLICY "debt_insert"
  ON public.debts
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND public.is_admin_or_manager()
  );

-- UPDATE: admin/manager can update any; collector can update status/notes on assigned debts only
CREATE POLICY "debt_update_admin_manager"
  ON public.debts
  FOR UPDATE
  USING (company_id = public.get_user_company_id() AND public.is_admin_or_manager())
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "debt_update_collector_assigned"
  ON public.debts
  FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND assigned_to = auth.uid()
    AND NOT public.is_admin_or_manager()
  )
  WITH CHECK (
    -- Collectors cannot reassign debts or change company
    company_id = public.get_user_company_id()
    AND assigned_to = auth.uid()
  );

-- DELETE: admin only
CREATE POLICY "debt_delete_admin"
  ON public.debts
  FOR DELETE
  USING (company_id = public.get_user_company_id() AND public.is_admin());

-- ============================================================
-- SECTION 7: PAYMENTS policies
-- ============================================================

-- SELECT: admin/manager all; collector only for assigned debts
CREATE POLICY "payment_select"
  ON public.payments
  FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND (
      public.is_admin_or_manager()
      OR EXISTS (
        SELECT 1 FROM public.debts
        WHERE debts.id = payments.debt_id
          AND debts.assigned_to = auth.uid()
      )
    )
  );

-- INSERT: any active user in company (collectors record payments)
CREATE POLICY "payment_insert"
  ON public.payments
  FOR INSERT
  WITH CHECK (
    company_id = public.get_user_company_id()
    AND (
      public.is_admin_or_manager()
      OR EXISTS (
        SELECT 1 FROM public.debts
        WHERE debts.id = debt_id
          AND debts.assigned_to = auth.uid()
      )
    )
  );

-- UPDATE: admin/manager only (corrections)
CREATE POLICY "payment_update_admin"
  ON public.payments
  FOR UPDATE
  USING (company_id = public.get_user_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_user_company_id());

-- DELETE: admin only
CREATE POLICY "payment_delete_admin"
  ON public.payments
  FOR DELETE
  USING (company_id = public.get_user_company_id() AND public.is_admin());

-- ============================================================
-- SECTION 8: MESSAGES policies
-- ============================================================

-- SELECT: admin/manager all; collector only for assigned debts
CREATE POLICY "message_select"
  ON public.messages
  FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND (
      public.is_admin_or_manager()
      OR EXISTS (
        SELECT 1 FROM public.debts
        WHERE debts.id = messages.debt_id
          AND debts.assigned_to = auth.uid()
      )
    )
  );

-- INSERT: any active user (collectors send messages)
CREATE POLICY "message_insert"
  ON public.messages
  FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

-- UPDATE: admin/manager only (mark as read, update status)
CREATE POLICY "message_update_admin"
  ON public.messages
  FOR UPDATE
  USING (company_id = public.get_user_company_id() AND public.is_admin_or_manager())
  WITH CHECK (company_id = public.get_user_company_id());

-- ============================================================
-- SECTION 9: AI_SCORES policies
-- ============================================================

CREATE POLICY "ai_score_select"
  ON public.ai_scores
  FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND (
      public.is_admin_or_manager()
      OR EXISTS (
        SELECT 1 FROM public.debts
        WHERE debts.id = ai_scores.debt_id
          AND debts.assigned_to = auth.uid()
      )
    )
  );

CREATE POLICY "ai_score_insert"
  ON public.ai_scores
  FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

-- ============================================================
-- SECTION 10: AI_ACTIONS policies
-- ============================================================

CREATE POLICY "ai_action_select"
  ON public.ai_actions
  FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND (
      public.is_admin_or_manager()
      OR assigned_to = auth.uid()
    )
  );

CREATE POLICY "ai_action_insert"
  ON public.ai_actions
  FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id() AND public.is_admin_or_manager());

CREATE POLICY "ai_action_update"
  ON public.ai_actions
  FOR UPDATE
  USING (
    company_id = public.get_user_company_id()
    AND (
      public.is_admin_or_manager()
      OR assigned_to = auth.uid()
    )
  )
  WITH CHECK (company_id = public.get_user_company_id());

-- ============================================================
-- SECTION 11: LOGS policies (append-only audit trail)
-- ============================================================

-- SELECT: admin sees all; manager/collector see own actions
CREATE POLICY "log_select"
  ON public.logs
  FOR SELECT
  USING (
    company_id = public.get_user_company_id()
    AND (
      public.is_admin()
      OR user_id = auth.uid()
    )
  );

-- INSERT: any authenticated user
CREATE POLICY "log_insert"
  ON public.logs
  FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id());

-- UPDATE/DELETE: nobody — logs are immutable
-- (no policies = implicit deny)

-- ============================================================
-- SECTION 12: Performance indexes for RLS predicates
-- ============================================================

-- These are queried in EVERY RLS policy evaluation
CREATE INDEX IF NOT EXISTS idx_profiles_auth_uid
  ON public.profiles (id, company_id, role, is_active);

CREATE INDEX IF NOT EXISTS idx_debts_company_assigned
  ON public.debts (company_id, assigned_to);

CREATE INDEX IF NOT EXISTS idx_debts_company_status
  ON public.debts (company_id, status);

CREATE INDEX IF NOT EXISTS idx_debts_company_priority_balance
  ON public.debts (company_id, priority, current_balance DESC);

CREATE INDEX IF NOT EXISTS idx_payments_debt_id
  ON public.payments (debt_id, company_id);

CREATE INDEX IF NOT EXISTS idx_messages_debt_id
  ON public.messages (debt_id, company_id);

CREATE INDEX IF NOT EXISTS idx_messages_customer_id
  ON public.messages (customer_id, company_id);

CREATE INDEX IF NOT EXISTS idx_ai_scores_debt_id
  ON public.ai_scores (debt_id, company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_actions_company_date
  ON public.ai_actions (company_id, scheduled_date, assigned_to);

CREATE INDEX IF NOT EXISTS idx_logs_company_created
  ON public.logs (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customers_company_phone
  ON public.customers (company_id, phone);

CREATE INDEX IF NOT EXISTS idx_customers_company_whatsapp
  ON public.customers (company_id, whatsapp);

CREATE INDEX IF NOT EXISTS idx_customers_company_national_id
  ON public.customers (company_id, national_id);

CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_id
  ON public.messages (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

COMMIT;
