BEGIN;

-- Collectors must not be able to enumerate every debtor in their company.
-- A collector may read a customer only when at least one debt for that
-- customer is assigned to the current user. Admins and managers retain the
-- tenant-wide view they need for assignment and reporting.
DROP POLICY IF EXISTS customer_select ON public.customers;

CREATE POLICY customer_select
  ON public.customers
  FOR SELECT
  TO authenticated
  USING (
    company_id = public.get_user_company_id()
    AND (
      public.get_user_role() IN ('admin', 'manager')
      OR EXISTS (
        SELECT 1
        FROM public.debts AS assigned_debt
        WHERE assigned_debt.company_id = customers.company_id
          AND assigned_debt.customer_id = customers.id
          AND assigned_debt.assigned_to = (SELECT auth.uid())
      )
    )
  );

CREATE INDEX IF NOT EXISTS idx_debts_company_assignee_customer
  ON public.debts (company_id, assigned_to, customer_id);

COMMIT;
