-- ============================================================
-- MIGRATION 005: Authentication Hardening
-- ============================================================

BEGIN;

-- ============================================================
-- SECTION 1: Session tracking (detect concurrent/suspicious sessions)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id    UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  session_token TEXT NOT NULL,     -- SHA256 hash of Supabase JWT
  ip_address    INET,
  user_agent    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

-- Users see their own sessions only
CREATE POLICY "session_select_own"
  ON public.user_sessions
  FOR SELECT
  USING (user_id = auth.uid());

-- Admin sees all sessions in company
CREATE POLICY "session_select_admin"
  ON public.user_sessions
  FOR SELECT
  USING (company_id = public.get_user_company_id() AND public.is_admin());

CREATE POLICY "session_update_own"
  ON public.user_sessions
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_user_sessions_user
  ON public.user_sessions (user_id, is_active, last_active_at DESC);

CREATE INDEX idx_user_sessions_token
  ON public.user_sessions (session_token)
  WHERE is_active = true;

-- ============================================================
-- SECTION 2: Failed login tracking (brute force protection)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.auth_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT NOT NULL,
  event_type  TEXT NOT NULL,   -- 'login_success' | 'login_failed' | 'password_reset' | 'invited' | 'mfa_challenge'
  ip_address  INET,
  user_agent  TEXT,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No RLS — service role only; used for security monitoring
CREATE INDEX idx_auth_events_email_time
  ON public.auth_events (email, created_at DESC);

CREATE INDEX idx_auth_events_ip_time
  ON public.auth_events (ip_address, created_at DESC)
  WHERE ip_address IS NOT NULL;

-- Function: check if an IP/email is brute-force blocked
CREATE OR REPLACE FUNCTION public.is_login_blocked(
  p_email     TEXT,
  p_ip        TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_failures INTEGER;
  v_ip_failures    INTEGER;
BEGIN
  -- Count failures in last 15 minutes for this email
  SELECT COUNT(*) INTO v_email_failures
  FROM public.auth_events
  WHERE email = p_email
    AND event_type = 'login_failed'
    AND created_at > NOW() - INTERVAL '15 minutes';

  IF v_email_failures >= 10 THEN
    RETURN true;
  END IF;

  -- Count failures in last 15 minutes from this IP
  IF p_ip IS NOT NULL THEN
    SELECT COUNT(*) INTO v_ip_failures
    FROM public.auth_events
    WHERE ip_address = p_ip::INET
      AND event_type = 'login_failed'
      AND created_at > NOW() - INTERVAL '15 minutes';

    IF v_ip_failures >= 20 THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- ============================================================
-- SECTION 3: API Keys (for external integrations / webhook senders)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,    -- SHA256(key), never store plaintext
  key_prefix   TEXT NOT NULL,           -- first 8 chars for display ('sk_live_')
  scopes       TEXT[] NOT NULL DEFAULT '{}',  -- ['read:debts', 'write:payments', etc.]
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID NOT NULL REFERENCES public.profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_key_select_admin"
  ON public.api_keys
  FOR SELECT
  USING (company_id = public.get_user_company_id() AND public.is_admin());

CREATE POLICY "api_key_insert_admin"
  ON public.api_keys
  FOR INSERT
  WITH CHECK (company_id = public.get_user_company_id() AND public.is_admin());

CREATE POLICY "api_key_update_admin"
  ON public.api_keys
  FOR UPDATE
  USING (company_id = public.get_user_company_id() AND public.is_admin())
  WITH CHECK (company_id = public.get_user_company_id());

CREATE POLICY "api_key_delete_admin"
  ON public.api_keys
  FOR DELETE
  USING (company_id = public.get_user_company_id() AND public.is_admin());

CREATE INDEX idx_api_keys_company
  ON public.api_keys (company_id, is_active);

CREATE INDEX idx_api_keys_hash
  ON public.api_keys (key_hash)
  WHERE is_active = true;

-- ============================================================
-- SECTION 4: Enforce profile email matches auth.users email
-- ============================================================

CREATE OR REPLACE FUNCTION public.validate_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NEW.email != (SELECT email FROM auth.users WHERE id = NEW.id) THEN
    RAISE EXCEPTION 'Profile email must match auth user email';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_profile_email_trigger ON public.profiles;
CREATE TRIGGER validate_profile_email_trigger
  BEFORE INSERT OR UPDATE OF email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_email();

-- ============================================================
-- SECTION 5: Prevent deactivated users from any data access
-- ============================================================
-- get_user_company_id() and get_user_role() already filter is_active=true
-- so deactivated users get NULL from those functions → RLS denies access.
-- This also blocks them from seeing their own profile (which is correct).

-- Add index to make is_active lookups efficient
CREATE INDEX IF NOT EXISTS idx_profiles_is_active
  ON public.profiles (id, is_active)
  WHERE is_active = true;

-- ============================================================
-- SECTION 6: Cleanup expired sessions
-- ============================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_sessions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.user_sessions
  SET is_active = false
  WHERE is_active = true
    AND expires_at < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ============================================================
-- SECTION 7: Settings schema enforcement for companies
-- ============================================================

-- Ensure company settings always has required keys with defaults
CREATE OR REPLACE FUNCTION public.normalize_company_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.settings := '{}'::jsonb
    || '{"currency":"SAR","timezone":"Asia/Riyadh","language":"en","whatsapp_enabled":false,"ai_scoring_enabled":true,"max_collectors":10}'::jsonb
    || NEW.settings;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_company_settings_trigger ON public.companies;
CREATE TRIGGER normalize_company_settings_trigger
  BEFORE INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.normalize_company_settings();

COMMIT;
