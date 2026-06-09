import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'

const createSchema = z.object({
  portfolio_id: z.string().uuid(),
  display_name: z.string().max(120).optional(),
  phone_number: z.string().min(8).max(30),
  provider: z.enum(['evolution']).default('evolution'),
  instance_name: z.string().min(2).max(120),
  api_url: z.string().url().optional(),
  is_active: z.boolean().default(true),
  daily_limit: z.number().int().min(1).max(5000).default(250),
  metadata: z.record(z.any()).default({}),
})

export async function GET(_req: NextRequest) {
  return withAuth(async (ctx) => {
    const { data, error } = await ctx.supabase
      .from('portfolio_whatsapp_numbers')
      .select('*, portfolio:portfolios(id,name,name_ar,code,category)')
      .eq('company_id', ctx.profile.company_id)
      .order('created_at', { ascending: false })

    if (error) return errors.internal(error.message)
    return NextResponse.json({ data: data ?? [] })
  })
}

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = createSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { data: portfolio, error: portfolioError } = await ctx.supabase
        .from('portfolios')
        .select('id')
        .eq('id', parsed.data.portfolio_id)
        .eq('company_id', ctx.profile.company_id)
        .maybeSingle()

      if (portfolioError) return errors.internal(portfolioError.message)
      if (!portfolio) return errors.notFound('Portfolio')

      const { data, error } = await ctx.supabase
        .from('portfolio_whatsapp_numbers')
        .insert({
          ...parsed.data,
          company_id: ctx.profile.company_id,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') return errors.conflict('WhatsApp number already linked')
        return errors.internal(error.message)
      }

      return NextResponse.json({ data }, { status: 201 })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}

export async function PATCH(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const { id, ...rest } = body as Record<string, unknown>
      if (!id || typeof id !== 'string') return errors.badRequest('id required')

      const { data, error } = await ctx.supabase
        .from('portfolio_whatsapp_numbers')
        .update(rest)
        .eq('id', id)
        .eq('company_id', ctx.profile.company_id)
        .select()
        .single()

      if (error) return errors.internal(error.message)
      if (!data) return errors.notFound('WhatsApp number')
      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
