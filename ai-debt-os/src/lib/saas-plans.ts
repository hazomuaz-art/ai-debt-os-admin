/**
 * SaaS Plans Foundation
 *
 * Provides:
 *   PLAN_DEFINITIONS   — canonical plan configs (used without DB for fast checks)
 *   getCompanyLimits() — resolves effective limits via DB (override > plan)
 *   getSubscription()  — fetch a company's active subscription
 *   getPlanById()      — fetch a single plan by name
 *   formatLimit()      — display helper for limit values
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('saas-plans')

// ── Canonical plan definitions (in-memory, no DB needed) ─────────────────
// These match the billing_plans rows seeded in migration 016.
// Used for instant UI rendering before DB responds.

export type PlanName = 'starter' | 'business' | 'enterprise' | 'growth'

export interface PlanLimits {
  max_users:           number
  max_customers:       number
  max_debts:           number
  daily_ai_actions:    number
  daily_openai_calls:  number
  monthly_whatsapp:    number
  monthly_messages:    number
  max_campaigns:       number
  monthly_imports:     number
  storage_gb:          number
  voice_minutes_month: number
}

export interface PlanFeatures {
  ai_scoring:    boolean
  ai_actions:    boolean
  whatsapp:      boolean
  voice:         boolean
  campaigns:     boolean
  api_access:    boolean
  sso:           boolean
  custom_rules:  boolean
}

export interface PlanDefinition {
  name:           PlanName
  display_name:   string
  monthly_usd:    number
  annual_usd:     number
  sort_order:     number
  is_active:      boolean
  limits:         PlanLimits
  features:       PlanFeatures
  badge_color:    string   // Tailwind class for UI badges
  highlight:      boolean  // Show as "popular" / recommended
}

export const PLAN_DEFINITIONS: Record<PlanName, PlanDefinition> = {
  starter: {
    name: 'starter', display_name: 'Starter',
    monthly_usd: 99, annual_usd: 79, sort_order: 1, is_active: true,
    limits: {
      max_users: 2, max_customers: 500, max_debts: 500,
      daily_ai_actions: 20, daily_openai_calls: 10,
      monthly_whatsapp: 500, monthly_messages: 1000,
      max_campaigns: 0, monthly_imports: 3, storage_gb: 1, voice_minutes_month: 0,
    },
    features: {
      ai_scoring: true, ai_actions: true, whatsapp: false,
      voice: false, campaigns: false, api_access: false,
      sso: false, custom_rules: false,
    },
    badge_color: 'bg-white/5 text-white/50 border-white/10',
    highlight: false,
  },
  business: {
    name: 'business', display_name: 'Business',
    monthly_usd: 299, annual_usd: 249, sort_order: 2, is_active: true,
    limits: {
      max_users: 10, max_customers: 5000, max_debts: 5000,
      daily_ai_actions: 100, daily_openai_calls: 50,
      monthly_whatsapp: 2000, monthly_messages: 5000,
      max_campaigns: 5, monthly_imports: 20, storage_gb: 10, voice_minutes_month: 100,
    },
    features: {
      ai_scoring: true, ai_actions: true, whatsapp: true,
      voice: true, campaigns: true, api_access: false,
      sso: false, custom_rules: true,
    },
    badge_color: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
    highlight: true,
  },
  growth: {
    name: 'growth', display_name: 'Growth',
    monthly_usd: 299, annual_usd: 249, sort_order: 2, is_active: true,
    limits: {
      max_users: 10, max_customers: 5000, max_debts: 5000,
      daily_ai_actions: 100, daily_openai_calls: 50,
      monthly_whatsapp: 2000, monthly_messages: 5000,
      max_campaigns: 5, monthly_imports: 20, storage_gb: 10, voice_minutes_month: 100,
    },
    features: {
      ai_scoring: true, ai_actions: true, whatsapp: true,
      voice: false, campaigns: true, api_access: false,
      sso: false, custom_rules: true,
    },
    badge_color: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
    highlight: false,
  },
  enterprise: {
    name: 'enterprise', display_name: 'Enterprise',
    monthly_usd: 999, annual_usd: 849, sort_order: 3, is_active: true,
    limits: {
      max_users: 50, max_customers: 100000, max_debts: 100000,
      daily_ai_actions: 1000, daily_openai_calls: 500,
      monthly_whatsapp: 10000, monthly_messages: 25000,
      max_campaigns: 50, monthly_imports: 200, storage_gb: 100, voice_minutes_month: 1000,
    },
    features: {
      ai_scoring: true, ai_actions: true, whatsapp: true,
      voice: true, campaigns: true, api_access: true,
      sso: true, custom_rules: true,
    },
    badge_color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    highlight: false,
  },
}

// ── Subscription types ─────────────────────────────────────────────────────

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'

export interface CompanySubscription {
  id:                      string
  company_id:              string
  plan_name:               PlanName
  status:                  SubscriptionStatus
  trial_ends_at:           string | null
  current_period_start:    string
  current_period_end:      string
  cancelled_at:            string | null
  billing_email:           string | null
  billing_cycle:           'monthly' | 'annual'
  mrr_usd:                 number
  notes:                   string | null
  created_at:              string
  updated_at:              string
}

export interface EffectiveLimits extends PlanLimits {
  plan:             PlanName
  feature_ai_scoring:    boolean
  feature_ai_actions:    boolean
  feature_whatsapp:      boolean
  feature_voice:         boolean
  feature_campaigns:     boolean
  feature_api_access:    boolean
  feature_sso:           boolean
  feature_custom_rules:  boolean
}

// ── DB helpers ─────────────────────────────────────────────────────────────

/**
 * Resolve a company's effective limits via the get_company_limits() DB function.
 * Falls back to PLAN_DEFINITIONS['starter'] if DB is unavailable.
 */
export async function getCompanyLimits(companyId: string): Promise<EffectiveLimits> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.rpc('get_company_limits', {
      p_company_id: companyId,
    })

    if (error || !data) {
      log.warn('get_company_limits RPC failed — using starter defaults')
      return buildFallbackLimits('starter')
    }

    return data as EffectiveLimits
  } catch {
    return buildFallbackLimits('starter')
  }
}

function buildFallbackLimits(planName: PlanName): EffectiveLimits {
  const plan = PLAN_DEFINITIONS[planName] ?? PLAN_DEFINITIONS.starter
  return {
    plan:                  planName,
    ...plan.limits,
    feature_ai_scoring:    plan.features.ai_scoring,
    feature_ai_actions:    plan.features.ai_actions,
    feature_whatsapp:      plan.features.whatsapp,
    feature_voice:         plan.features.voice,
    feature_campaigns:     plan.features.campaigns,
    feature_api_access:    plan.features.api_access,
    feature_sso:           plan.features.sso,
    feature_custom_rules:  plan.features.custom_rules,
  }
}

/**
 * Fetch a company's subscription row.
 * Returns null if no subscription exists (new company on implicit trial).
 */
export async function getSubscription(companyId: string): Promise<CompanySubscription | null> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('company_subscriptions')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle()
    return data as CompanySubscription | null
  } catch {
    return null
  }
}

/**
 * Fetch all billing plans from DB, ordered by sort_order.
 */
export async function getAllPlans(): Promise<PlanDefinition[]> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('billing_plans')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')

    if (!data?.length) return Object.values(PLAN_DEFINITIONS).filter(p => p.is_active)

    return data.map((row: Record<string, unknown>) => ({
      name:           row.name as PlanName,
      display_name:   row.display_name,
      monthly_usd:    Number(row.monthly_price_usd ?? row.price_usd ?? 0),
      annual_usd:     Number(row.annual_price_usd ?? 0),
      sort_order:     row.sort_order ?? 0,
      is_active:      row.is_active,
      limits: {
        max_users:           row.max_users        ?? 5,
        max_customers:       row.max_customers     ?? 1000,
        max_debts:           row.max_debts         ?? 1000,
        daily_ai_actions:    row.daily_ai_actions  ?? 50,
        daily_openai_calls:  row.daily_openai_calls ?? 20,
        monthly_whatsapp:    row.monthly_whatsapp   ?? 500,
        monthly_messages:    row.monthly_messages   ?? 1000,
        max_campaigns:       row.max_campaigns      ?? 0,
        monthly_imports:     row.monthly_imports    ?? 5,
        storage_gb:          Number(row.storage_gb  ?? 1),
        voice_minutes_month: row.voice_minutes_month ?? 0,
      },
      features: {
        ai_scoring:   row.feature_ai_scoring   ?? true,
        ai_actions:   row.feature_ai_actions   ?? true,
        whatsapp:     row.feature_whatsapp     ?? false,
        voice:        row.feature_voice        ?? false,
        campaigns:    row.feature_campaigns    ?? false,
        api_access:   row.feature_api_access   ?? false,
        sso:          row.feature_sso          ?? false,
        custom_rules: row.feature_custom_rules ?? false,
      },
      badge_color: PLAN_DEFINITIONS[row.name as PlanName]?.badge_color
                   ?? 'bg-white/5 text-white/50 border-white/10',
      highlight: PLAN_DEFINITIONS[row.name as PlanName]?.highlight ?? false,
    }))
  } catch {
    return Object.values(PLAN_DEFINITIONS).filter(p => p.is_active)
  }
}

// ── Display helpers ───────────────────────────────────────────────────────

/** Format a limit value for display: null/undefined = "Unlimited" */
export function formatLimit(value: number | null | undefined, unit = ''): string {
  if (value == null || value === 0) return '—'
  if (value >= 999999) return 'Unlimited'
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K${unit ? ' ' + unit : ''}`
  return `${value}${unit ? ' ' + unit : ''}`
}

/** Usage percentage, capped at 100 */
export function usagePct(used: number, limit: number | null | undefined): number {
  if (!limit || limit >= 999999) return 0
  return Math.min(100, Math.round((used / limit) * 100))
}

/** Colour for usage bar based on percentage */
export function usageColor(pct: number): string {
  if (pct >= 90) return '#ef4444'  // red
  if (pct >= 70) return '#f59e0b'  // amber
  return '#4f46e5'                  // brand
}

/** Label for subscription status */
export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trial:     'Trial',
  active:    'Active',
  past_due:  'Past Due',
  suspended: 'Suspended',
  cancelled: 'Cancelled',
}

export const STATUS_COLORS: Record<SubscriptionStatus, string> = {
  trial:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
  active:    'bg-green-500/10 text-green-400 border-green-500/20',
  past_due:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  suspended: 'bg-red-500/10 text-red-400 border-red-500/20',
  cancelled: 'bg-white/5 text-white/30 border-white/10',
}
