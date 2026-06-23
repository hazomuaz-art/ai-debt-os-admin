import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'

const createSchema = z.object({
  portfolio_id: z.string().uuid().nullable().optional(),
  method_type: z.enum(['iban', 'sadad_biller']),
  iban: z.string().max(34).optional().nullable(),
  account_name: z.string().max(200).optional().nullable(),
  bank_name: z.string().max(200).optional().nullable(),
  biller_code: z.string().max(50).optional().nullable(),
  biller_name: z.string().max(200).optional().nullable(),
  instructions: z.string().max(500).optional().nullable(),
})

export async function GET(req: NextRequest) {
  return withAuth(async (ctx) => {
    const portfolioId = req.nextUrl.searchParams.get('portfolio_id')
    let q = ctx.supabase
      .from('collection_accounts')
      .select('*')
      .eq('company_id', ctx.profile.company_id)
      .order('created_at', { ascending: false })
    if (portfolioId) q = q.eq('portfolio_id', portfolioId)

    const { data, error } = await q
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

      // No fabricated values — require the actual identifier for the
      // chosen method, never let an empty row pretend to be a real account.
      if (parsed.data.method_type === 'iban' && !parsed.data.iban) {
        return errors.badRequest('iban is required for method_type=iban')
      }
      if (parsed.data.method_type === 'sadad_biller' && !parsed.data.biller_code) {
        return errors.badRequest('biller_code is required for method_type=sadad_biller')
      }

      const { data, error } = await ctx.supabase
        .from('collection_accounts')
        .insert({ ...parsed.data, company_id: ctx.profile.company_id, is_active: true })
        .select()
        .single()

      if (error) return errors.internal(error.message)
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
        .from('collection_accounts')
        .update(rest)
        .eq('id', id)
        .eq('company_id', ctx.profile.company_id)
        .select()
        .single()

      if (error) return errors.internal(error.message)
      if (!data) return errors.notFound('Collection account')
      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
