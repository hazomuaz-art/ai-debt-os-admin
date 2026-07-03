'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth')

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
    cookies().set('mock-auth-logged-in', 'true', { path: '/' })
    redirect('/dashboard/admin')
  }

  const supabase = createClient()

  const parsed = loginSchema.safeParse({
    email:    formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { error: parsed.error.errors[0].message }
  }

  const { data: authData, error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Generic message to prevent email enumeration
    log.warn('Login failed', { email: parsed.data.email, error: error.message })
    return { error: 'Invalid email or password' }
  }

  if (!authData.user) return { error: 'Authentication failed' }

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
  redirect(`/dashboard/${role}`)
}

export async function registerAction(formData: FormData) {
  const isDummyUrl = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('dummy')
  if (isDummyUrl) {
    const { cookies } = await import('next/headers')
    cookies().set('mock-auth-logged-in', 'true', { path: '/' })
    redirect('/dashboard/admin')
  }

  const serviceClient = createServiceClient()
  const supabase      = createClient()

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
    cookies().delete('mock-auth-logged-in')
    redirect('/login')
  }

  const supabase = createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function getCurrentUser() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, company:companies(*)')
    .eq('id', user.id)
    .single()

  return profile
}
