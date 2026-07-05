import { NextRequest, NextResponse } from 'next/server'
import { withAuth, parseQuery, errors } from '@/lib/api'
import { normalizePhone, toSaudiIntlPhone } from '@/lib/whatsapp'
import { z } from 'zod'

const customersQuerySchema = z.object({
  search: z.string().max(100).optional(),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  page:   z.coerce.number().int().min(1).default(1),
})

export async function GET(request: NextRequest) {
  return withAuth(async (ctx) => {
    const { data: query, error: queryErr } = parseQuery(
      request.nextUrl.searchParams,
      customersQuerySchema
    )
    if (queryErr) return queryErr

    const page = query.page ?? 1
    const limit = query.limit ?? 20
    const offset = (page - 1) * limit

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dbQuery: any = ctx.supabase
      .from('customers')
      .select('id, full_name, phone, whatsapp, national_id, city, employer, monthly_income, risk_level, created_at', { count: 'exact' })
      .eq('company_id', ctx.profile.company_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (query.search) {
      dbQuery = dbQuery.or(
        `full_name.ilike.%${query.search}%,phone.ilike.%${query.search}%,national_id.ilike.%${query.search}%`
      )
    }

    const { data, error, count } = await dbQuery

    if (error) {
      return errors.internal()
    }

    return NextResponse.json({ data: data ?? [], count, page, limit })
  })
}

const patchSchema = z.object({
  id:       z.string().uuid(),
  whatsapp: z.string().min(9).max(20),
})

export async function PATCH(request: NextRequest) {
  return withAuth(async (ctx) => {
    let body: unknown
    try { body = await request.json() } catch { return errors.badRequest('Invalid JSON') }

    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) return errors.badRequest('Invalid payload')

    const { id, whatsapp } = parsed.data
    const normalized = normalizePhone(whatsapp)

    if (!/^\d{10,15}$/.test(normalized) || normalized.startsWith('0')) {
      return errors.badRequest('رقم واتساب غير صحيح')
    }

    // Real inconsistency found during a full-system audit: this stored
    // digit-only (e.g. "966501234567") while customer creation stores
    // "+966501234567" — both formats coexist across real rows today,
    // printing inconsistently depending on which path last touched a given
    // customer. toSaudiIntlPhone() is the shared, single format going forward.
    const stored = toSaudiIntlPhone(whatsapp) ?? normalized
    const { error } = await ctx.supabase
      .from('customers')
      .update({ whatsapp: stored })
      .eq('id', id)
      .eq('company_id', ctx.profile.company_id)

    if (error) return errors.internal()
    return NextResponse.json({ success: true, whatsapp: stored })
  })
}
