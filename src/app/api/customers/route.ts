import { NextRequest, NextResponse } from 'next/server'
import { withAuth, parseQuery, errors } from '@/lib/api'
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
