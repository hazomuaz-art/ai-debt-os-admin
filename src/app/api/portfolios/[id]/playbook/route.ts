import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { getPlaybookForPortfolio, type PortfolioCategory } from '@/lib/company-playbook'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/portfolios/playbook')

const playbookSchema = z.object({
  discounts: z.object({
    allowed: z.boolean(),
    max_percent: z.number().min(0).max(100),
    requires_admin_approval: z.literal(true), // never relax this from the UI
  }),
  installments: z.object({
    allowed: z.boolean(),
    max_months: z.number().min(0).max(36),
    requires_admin_approval: z.literal(true),
  }),
  fields_to_surface: z.array(z.string()).max(30),
  allowed_dispute_types: z.array(z.string()).max(20),
  notes: z.string().max(1000).optional().nullable(),
  company_policy: z.string().max(5000).optional().nullable(),
  ai_instructions: z.string().max(5000).optional().nullable(),
  forbidden_phrases: z.array(z.string().max(200)).max(100).optional(),
  escalation_rules: z.array(z.object({
    keywords: z.array(z.string().max(100)).min(1).max(20),
    reason: z.string().max(500),
  })).max(50).optional(),
  portfolio_specific_rules: z.string().max(5000).optional().nullable(),
})

export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAuth(async (ctx) => {
    const { data: portfolio, error: pErr } = await ctx.supabase
      .from('portfolios')
      .select('id, category')
      .eq('id', params.id)
      .eq('company_id', ctx.profile.company_id)
      .maybeSingle()
    if (pErr) return errors.internal(pErr.message)
    if (!portfolio) return errors.notFound('Portfolio')

    const playbook = await getPlaybookForPortfolio({
      company_id: ctx.profile.company_id,
      portfolio_id: params.id,
      category: portfolio.category as PortfolioCategory,
    })
    return NextResponse.json({ data: playbook })
  })
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = playbookSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { data: portfolio } = await ctx.supabase
        .from('portfolios')
        .select('id, category')
        .eq('id', params.id)
        .eq('company_id', ctx.profile.company_id)
        .maybeSingle()
      if (!portfolio) return errors.notFound('Portfolio')

      // Insurance-only dispute types are stripped here too, server-side —
      // never trust the client form alone, even though the UI also hides
      // them for non-insurance categories.
      const INSURANCE_ONLY = ['recourse', 'third_party', 'recovered_deduction']
      const allowedDisputeTypes = portfolio.category === 'insurance'
        ? parsed.data.allowed_dispute_types
        : parsed.data.allowed_dispute_types.filter(t => !INSURANCE_ONLY.includes(t))

      const { data: latest } = await ctx.supabase
        .from('company_playbooks')
        .select('version')
        .eq('portfolio_id', params.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextVersion = (latest?.version ?? 0) + 1

      // Deactivate the previous active row, insert the new version active —
      // this is the audit trail / versioning the JSON-on-portfolio approach
      // could not give us.
      // Real gap found during a full-system audit: unchecked — a rejected
      // deactivation could leave TWO rows with is_active=true for the same
      // portfolio, making "the active playbook" ambiguous for every caller
      // that reads it.
      const { error: deactivateErr } = await ctx.supabase.from('company_playbooks')
        .update({ is_active: false })
        .eq('portfolio_id', params.id)
        .eq('is_active', true)
      if (deactivateErr) log.error('failed to deactivate previous playbook version', new Error(deactivateErr.message), { portfolio_id: params.id })

      const { data, error } = await ctx.supabase
        .from('company_playbooks')
        .insert({
          company_id: ctx.profile.company_id,
          portfolio_id: params.id,
          version: nextVersion,
          is_active: true,
          discounts: parsed.data.discounts,
          installments: parsed.data.installments,
          fields_to_surface: parsed.data.fields_to_surface,
          allowed_dispute_types: allowedDisputeTypes,
          notes: parsed.data.notes ?? null,
          company_policy: parsed.data.company_policy ?? null,
          ai_instructions: parsed.data.ai_instructions ?? null,
          forbidden_phrases: parsed.data.forbidden_phrases ?? [],
          escalation_rules: parsed.data.escalation_rules ?? [],
          portfolio_specific_rules: parsed.data.portfolio_specific_rules ?? null,
          created_by: ctx.profile.id,
        })
        .select()
        .single()

      if (error) return errors.internal(error.message)
      return NextResponse.json({ data }, { status: 201 })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
