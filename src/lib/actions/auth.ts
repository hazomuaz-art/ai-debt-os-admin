'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'
import { logSecurityEvent } from '@/lib/security-audit'

const log = createLogger('auth')

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers()
    const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null
    return { ip, userAgent: h.get('user-agent') }
  } catch {
    return { ip: null, userAgent: null }
  }
}

// Brute-force protection (NCA ECC hardening, 2026-07-05): a real gap found
// during a live audit - nothing anywhere in this codebase rate-limited login
// attempts, meaning any email address could be password-guessed indefinitely
// with zero friction. middleware.ts's API_RATE_LIMITS never covered this
// Server Action (it only matches specific /api/* paths). In-memory per-
// instance state, same pattern already used in middleware.ts - this app runs
// as a single pm2 process, so this is a real, effective gate, not a no-op.
const FAILED_LOGIN_MAX     = 8
const FAILED_LOGIN_WINDOW_MS = 15 * 60_000 // 15 minutes
const failedLoginStore = new Map<string, { count: number; resetAt: number }>()

function isLoginLockedOut(email: string): boolean {
  const key = email.trim().toLowerCase()
  const entry = failedLoginStore.get(key)
  if (!entry || entry.resetAt <= Date.now()) return false
  return entry.count >= FAILED_LOGIN_MAX
}

function recordFailedLogin(email: string): void {
  const key = email.trim().toLowerCase()
  const now = Date.now()
  const entry = failedLoginStore.get(key)
  if (!entry || entry.resetAt <= now) {
    failedLoginStore.set(key, { count: 1, resetAt: now + FAILED_LOGIN_WINDOW_MS })
  } else {
    entry.count++
  }
}

function clearFailedLogins(email: string): void {
  failedLoginStore.delete(email.trim().toLowerCase())
}

const loginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
})

const registerSchema = z.object({
  email:        z.string().email('Invalid email address'),
  password:     z.string().min(8, 'Password must be at least 8 characters'),
  full_name:    z.string().min(2, 'Name must be at least 2 characters').max(200),
  company_name: z.string().min(2, 'Company name must be at least 2 characters').max(200),
})

export async function loginAction(formData: FormData) {
  const isDummyUrl = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('dummy')
  if (isDummyUrl) {
    const { cookies } = await import('next/headers')
    ;(await cookies()).set('mock-auth-logged-in', 'true', { path: '/' })
    redirect('/dashboard/admin')
  }

  const supabase = await createClient()

  const parsed = loginSchema.safeParse({
    email:    formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.errors[0].message }
  }

  if (isLoginLockedOut(parsed.data.email)) {
    log.warn('Login blocked - too many failed attempts', { email: parsed.data.email })
    return { error: 'محاولات كثيرة فاشلة. حاول مرة أخرى بعد 15 دقيقة.' }
  }

  const { data: authData, error } = await supabase.auth.signInWithPassword(parsed.data)
  const { ip, userAgent } = await requestMeta()

  if (error) {
    // Generic message to prevent email enumeration
    log.warn('Login failed', { email: parsed.data.email, error: error.message })
    recordFailedLogin(parsed.data.email)
    await logSecurityEvent({ actor_email: parsed.data.email, event_type: 'login_failed', ip_address: ip, user_agent: userAgent })
    return { error: 'Invalid email or password' }
  }

  if (!authData.user) return { error: 'Authentication failed' }

  clearFailedLogins(parsed.data.email)

  // Check account is active
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active, company_id')
    .eq('id', authData.user.id)
    .single()

  if (!profile?.is_active) {
    await supabase.auth.signOut()
    return { error: 'Your account has been deactivated. Contact your administrator.' }
  }

  if (!profile?.company_id) {
    return { error: 'Account setup incomplete. Contact support.' }
  }

  const role = profile.role ?? 'collector'

  await logSecurityEvent({
    company_id: profile.company_id, actor_user_id: authData.user.id, actor_email: parsed.data.email,
    event_type: 'login_success', ip_address: ip, user_agent: userAgent,
  })

  // MFA enforcement (NCA/compliance hardening, 2026-07-05): before this,
  // a password alone was sufficient for full access to every role,
  // including 'admin' which can delete customers and view all financial
  // data platform-wide. Required for privileged roles (admin, manager);
  // optional for collector. The middleware re-checks this on every
  // /dashboard/* request too, so this redirect can't be bypassed by
  // navigating straight to a dashboard URL after password login.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
    redirect('/mfa-challenge')
  }
  if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal1' && ['admin', 'manager'].includes(role)) {
    redirect('/mfa-setup?required=true')
  }

  redirect(`/dashboard/${role}`)
}

// ============================================================
// MFA (TOTP) - enrollment and challenge
// ============================================================

export async function enrollMfaAction(): Promise<
  { factorId: string; qrCode: string; secret: string } | { error: string }
> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
  if (error) {
    log.error('MFA enroll failed', error)
    return { error: error.message }
  }
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret }
}

// Cancels an in-progress (unverified) enrollment - lets a user re-scan a
// fresh QR code if the first attempt's code doesn't match, without leaving
// an abandoned "unverified" factor behind.
export async function cancelMfaEnrollmentAction(factorId: string): Promise<void> {
  const supabase = await createClient()
  await supabase.auth.mfa.unenroll({ factorId }).catch(() => {})
}

async function redirectToOwnDashboard(supabase: Awaited<ReturnType<typeof createClient>>): Promise<never> {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  redirect(`/dashboard/${profile?.role ?? 'collector'}`)
}

export async function verifyMfaEnrollmentAction(factorId: string, code: string) {
  const supabase = await createClient()
  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId })
  if (challengeError) return { error: challengeError.message }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId, challengeId: challenge.id, code,
  })
  if (verifyError) return { error: 'رمز غير صحيح، تأكد من الوقت الصحيح بجهازك وحاول مرة أخرى' }

  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: p } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
    await logSecurityEvent({ company_id: p?.company_id, actor_user_id: user.id, actor_email: user.email, event_type: 'mfa_enrolled' })
  }

  await redirectToOwnDashboard(supabase)
}

export async function verifyMfaChallengeAction(code: string) {
  const supabase = await createClient()
  const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
  if (factorsError) return { error: factorsError.message }

  const factor = factors.totp.find(f => f.status === 'verified')
  if (!factor) return { error: 'لا يوجد عامل مصادقة ثنائية مفعّل على هذا الحساب' }

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: factor.id })
  if (challengeError) return { error: challengeError.message }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: factor.id, challengeId: challenge.id, code,
  })

  const { data: { user } } = await supabase.auth.getUser()
  const { data: p } = user
    ? await supabase.from('profiles').select('company_id').eq('id', user.id).single()
    : { data: null }

  if (verifyError) {
    if (user) await logSecurityEvent({ company_id: p?.company_id, actor_user_id: user.id, actor_email: user.email, event_type: 'mfa_challenge_failed' })
    return { error: 'رمز غير صحيح، حاول مرة أخرى' }
  }

  if (user) await logSecurityEvent({ company_id: p?.company_id, actor_user_id: user.id, actor_email: user.email, event_type: 'mfa_challenge_success' })

  await redirectToOwnDashboard(supabase)
}

export async function registerAction(formData: FormData) {
  const isDummyUrl = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('dummy')
  if (isDummyUrl) {
    const { cookies } = await import('next/headers')
    ;(await cookies()).set('mock-auth-logged-in', 'true', { path: '/' })
    redirect('/dashboard/admin')
  }

  const serviceClient = createServiceClient()
  const supabase      = await createClient()

  const parsed = registerSchema.safeParse({
    email:        formData.get('email'),
    password:     formData.get('password'),
    full_name:    formData.get('full_name'),
    company_name: formData.get('company_name'),
  })

  if (!parsed.success) {
    return { error: parsed.error.errors[0].message }
  }

  // Check if email already exists
  const { data: existing } = await serviceClient
    .from('profiles')
    .select('id')
    .eq('email', parsed.data.email)
    .maybeSingle()

  if (existing) {
    return { error: 'An account with this email already exists. Try logging in.' }
  }

  // Create company
  const slug = parsed.data.company_name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    + '-' + Date.now().toString(36)

  const { data: company, error: companyError } = await serviceClient
    .from('companies')
    .insert({ name: parsed.data.company_name, slug, plan: 'starter' })
    .select('id')
    .single()

  if (companyError || !company) {
    log.error('Company creation failed', companyError)
    return { error: 'Failed to create company workspace' }
  }

  // Create auth user (admin role for first user)
  const { data: authData, error: signUpError } = await supabase.auth.signUp({
    email:    parsed.data.email,
    password: parsed.data.password,
    options:  {
      data: { full_name: parsed.data.full_name, role: 'admin' },
    },
  })

  if (signUpError || !authData.user) {
    const { error: cleanupErr } = await serviceClient.from('companies').delete().eq('id', company.id)
    if (cleanupErr) log.error('rollback: failed to delete orphaned company after signup failure', new Error(cleanupErr.message), { company_id: company.id })
    log.error('Auth user creation failed during register', signUpError)
    if (signUpError?.message?.toLowerCase().includes('already registered')) {
      return { error: 'An account with this email already exists. Try logging in.' }
    }
    return { error: signUpError?.message ?? 'Registration failed' }
  }

  // The handle_new_user trigger creates the profile row.
  // Update it with company_id and role via service client.
  const { error: profileError } = await serviceClient
    .from('profiles')
    .update({
      company_id: company.id,
      role:       'admin',
      full_name:  parsed.data.full_name,
      is_active:  true,
    })
    .eq('id', authData.user.id)

  if (profileError) {
    log.error('Profile update failed during register', profileError)
    // Best-effort cleanup — logged (not silenced) so an orphaned company row
    // left behind by a failed cleanup is at least visible in the logs.
    await serviceClient.auth.admin.deleteUser(authData.user.id).catch(() => {})
    const { error: cleanupErr } = await serviceClient.from('companies').delete().eq('id', company.id)
    if (cleanupErr) log.error('registration cleanup: company delete failed', cleanupErr, { company_id: company.id })
    return { error: 'Account setup failed. Please try again.' }
  }

  log.info('New company registered', { company_id: company.id, email: parsed.data.email })
  redirect('/dashboard/admin')
}

export async function logoutAction() {
  const isDummyUrl = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('dummy')
  if (isDummyUrl) {
    const { cookies } = await import('next/headers')
    ;(await cookies()).delete('mock-auth-logged-in')
    redirect('/login')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: p } = await supabase.from('profiles').select('company_id').eq('id', user.id).single()
    await logSecurityEvent({ company_id: p?.company_id, actor_user_id: user.id, actor_email: user.email, event_type: 'logout' })
  }
  await supabase.auth.signOut()
  redirect('/login')
}

export async function getCurrentUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, company:companies(*)')
    .eq('id', user.id)
    .single()

  return profile
}
