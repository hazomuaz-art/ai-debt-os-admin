import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'

const createSchema = z.object({
  name:       z.string().min(2).max(200),
  name_ar:    z.string().max(200).optional(),
  code:       z.string().min(2).max(20).toUpperCase(),
  category:   z.enum(['telecom','insurance','utility','recruitment','government','finance','agriculture','other']),
  color:      z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6272f1'),
  external_id: z.string().max(100).optional(),
  source_system: z.enum(['manual','debit_collect','tamiuzz','api']).default('manual'),
  notes:      z.string().max(500).optional(),
})

export async function GET(_req: NextRequest) {
  return withAuth(async (ctx) => {
    const { data, error } = await ctx.supabase
      .from('portfolios')
      .select('*')
      .eq('company_id', ctx.profile.company_id)
      .order('name')

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

      const { data, error } = await ctx.supabase
        .from('portfolios')
        .insert({ ...parsed.data, company_id: ctx.profile.company_id })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') return errors.conflict('A portfolio with this code already exists')
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
        .from('portfolios')
        .update(rest)
        .eq('id', id)
        .eq('company_id', ctx.profile.company_id)
        .select()
        .single()

      if (error) return errors.internal(error.message)
      if (!data)  return errors.notFound('Portfolio')
      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
