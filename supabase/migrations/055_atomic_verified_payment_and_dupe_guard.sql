BEGIN;

-- ============================================================
-- MIGRATION 055: Atomic verified-payment application
--
-- Root-cause production-readiness audit finding (2026-07-09), confirmed by
-- a real production incident this session (customer RAYMOND LASTRELLA
-- BLANCAFLOR / 4a47f571): payment-receipt.ts read debts.current_balance
-- once, computed the new balance in application memory, and wrote it back
-- with a plain UPDATE — no WHERE guard on the value it read, no DB-side
-- arithmetic. Two receipts for the same debt processed concurrently (each
-- attachment runs in its own detached async task) race on that read, and
-- one payment's deduction can be silently lost even though both `payments`
-- rows correctly show completed/verified. This function makes the decrement,
-- the resulting status transition, and the promise-outcome update a single
-- atomic operation anchored on the CURRENT value in the database, never a
-- stale in-memory snapshot.
-- ============================================================

CREATE OR REPLACE FUNCTION public.apply_verified_payment(
  p_debt_id uuid,
  p_company_id uuid,
  p_amount numeric
) RETURNS TABLE(new_balance numeric, new_status text, promise_outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_balance numeric;
  v_old_status text;
  v_new_status text;
  v_promise_outcome text;
BEGIN
  -- Atomic decrement anchored on the row's CURRENT value at UPDATE time
  -- (current_balance - p_amount), not a value read earlier in a separate
  -- statement — this is what actually closes the race.
  UPDATE public.debts
  SET current_balance = GREATEST(0, current_balance - p_amount)
  WHERE id = p_debt_id AND company_id = p_company_id
  RETURNING current_balance, status INTO v_new_balance, v_old_status;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'debt % not found for company %', p_debt_id, p_company_id;
  END IF;

  -- Same status-transition rule payment-receipt.ts always applied: settle
  -- on a zero balance, otherwise only move a promised/overdue debt back to
  -- active — any other status (e.g. disputed) is left untouched.
  v_new_status := CASE
    WHEN v_new_balance <= 0 THEN 'settled'
    WHEN v_old_status IN ('promised', 'overdue') THEN 'active'
    ELSE v_old_status
  END;
  IF v_new_status IS DISTINCT FROM v_old_status THEN
    UPDATE public.debts SET status = v_new_status WHERE id = p_debt_id;
  END IF;

  -- A payment that doesn't fully close the debt only PARTIALLY honors an
  -- open promise, never fully "kept" — same rule as before, just atomic now.
  v_promise_outcome := CASE WHEN v_new_balance <= 0 THEN 'kept' ELSE 'partial' END;
  UPDATE public.promises
  SET status = v_promise_outcome,
      fulfilled_at = CASE WHEN v_promise_outcome = 'kept' THEN now() ELSE fulfilled_at END
  WHERE company_id = p_company_id AND debt_id = p_debt_id AND status = 'pending';

  RETURN QUERY SELECT v_new_balance, v_new_status, v_promise_outcome;
END;
$$;

-- SECURITY DEFINER function touching financial balances — only the
-- service-role backend (payment-receipt.ts) may call it, never a
-- client-authenticated session.
REVOKE ALL ON FUNCTION public.apply_verified_payment(uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_verified_payment(uuid, uuid, numeric) FROM anon, authenticated;

-- Defense-in-depth: current_balance should never go negative. Application
-- logic (and the function above) already floor it at 0 via GREATEST, but a
-- DB-level CHECK means no future write path (a bug, a manual SQL edit, a
-- different code path entirely) can silently violate that invariant.
ALTER TABLE public.debts
  ADD CONSTRAINT debts_current_balance_nonneg CHECK (current_balance >= 0);

COMMIT;
