'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import crypto from 'crypto'

const log = createLogger('platform-actions')

/**
 * Creates a brand-new company + its first admin user together — owner-
 * triggered version of the same atomic create-company-and-admin logic as
 * registerAction() in src/lib/actions/auth.ts (that one is for public
 * self-signup and is intentionally NOT used anywhere yet; this one is for
 * the platform owner creating an account on behalf of a paying subscriber
 * after receiving payment manually, since no payment gateway is wired up).
 *
 * Differences from registerAction(): does not log the caller in as the new
 * user, generates a temporary password instead of accepting one, and also
 * creates the company_subscriptions row (trial, on the chosen plan) that
 * registerAction() never created.
 *
 * Restricted to the platform owner — callers must check isPlatformOwner
 * themselves (mirrors the page-level check in platform/companies pages).
 */
export async function createCompanyAction(args: {
  company_name: string
  admin_email: string
  admin_full_name: string
  plan_name: 'starter' | 'business' | 'growth' | 'enterprise'
}): Promise<{ error: string } | { success: true; temp_password: string; company_id: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const { data: callerProfile } = await supabase
    .from('profiles').select('company_id, role').eq('id', user.id).single()
  if (!callerProfile?.company_id || callerProfile.role !== 'admin' || callerProfile.company_id !== process.env.PLATFORM_OWNER_COMPANY_ID) {
    return { error: 'Forbidden' }
  }

  const companyName = args.company_name.trim()
  const email = args.admin_email.trim().toLowerCase()
  const fullName = args.admin_full_name.trim()
  if (companyName.length < 2 || !email.includes('@') || fullName.length < 2) {
    return { error: 'Invalid input' }
  }

  const serviceClient = createServiceClient()

  const { data: existing } = await serviceClient
    .from('profiles').select('id').eq('email', email).maybeSingle()
  if (existing) return { error: 'An account with this email already exists.' }

  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36)

  const { data: company, error: companyError } = await serviceClient
    .from('companies')
    .insert({ name: companyName, slug, plan: args.plan_name })
    .select('id').single()
  if (companyError || !company) {
    log.error('Company creation failed', companyError)
    return { error: 'Failed to create company' }
  }

  const tempPassword = crypto.randomBytes(12).toString('base64url')

  const { data: authData, error: createUserErr } = await serviceClient.auth.admin.createUser({
    email, password: tempPassword, email_confirm: true,
    user_metadata: { full_name: fullName, role: 'admin' },
  })
  if (createUserErr || !authData.user) {
    const { error: cleanupErr1 } = await serviceClient.from('companies').delete().eq('id', company.id)
    if (cleanupErr1) log.error('cleanup after admin-user creation failure: company delete failed', cleanupErr1, { company_id: company.id })
    log.error('Admin user creation failed', createUserErr)
    return { error: createUserErr?.message ?? 'Failed to create the admin account' }
  }

  const { error: profileError } = await serviceClient
    .from('profiles')
    .update({ company_id: company.id, role: 'admin', full_name: fullName, is_active: true })
    .eq('id', authData.user.id)
  if (profileError) {
    log.error('Profile update failed', profileError)
    await serviceClient.auth.admin.deleteUser(authData.user.id).catch(() => {})
    const { error: cleanupErr2 } = await serviceClient.from('companies').delete().eq('id', company.id)
    if (cleanupErr2) log.error('cleanup after profile-update failure: company delete failed', cleanupErr2, { company_id: company.id })
    return { error: 'Account setup failed. Please try again.' }
  }

  // The gap confirmed during the SaaS audit — registerAction() never created
  // this row at all, so subscriptions only ever existed for the manually
  // seeded demo company.
  const { error: subError } = await serviceClient
    .from('company_subscriptions')
    .insert({ company_id: company.id, plan_name: args.plan_name, status: 'trial', billing_email: email })
  if (subError) log.error('Subscription row creation failed (non-fatal, company still usable)', subError)

  log.info('Platform owner created new company', { company_id: company.id, email })
  return { success: true, temp_password: tempPassword, company_id: company.id }
}
