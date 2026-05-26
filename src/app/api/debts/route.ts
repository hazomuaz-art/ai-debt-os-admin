import { NextRequest, NextResponse } from 'next/server'
import { withAuth, parseBody, parseQuery, errors, createDebtSchema, listDebtsQuerySchema } from '@/lib/api'
import { generateReferenceNumber } from '@/lib/utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/debts')

export async function GET(request: NextRequest) {
  return withAuth(async (ctx) => {
    const { data: query, error: queryErr } = parseQuery(
      request.nextUrl.searchParams,
      listDebtsQuerySchema
    )
    if (queryErr) return queryErr

    const offset = (query.page - 1) * query.limit

    // Build query with explicit type annotation to avoid cast hacks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dbQuery: any = ctx.supabase
      .from('debts')
      .select(`
        id, reference_number, original_amount, current_balance, currency,
        status, priority, due_date, last_payment_date, product_type, created_at,
        customer:customers(id, full_name, phone, whatsapp),
        assigned_collector:profiles!debts_assigned_to_fkey(id, full_name),
        ai_scores(score, risk_classification, created_at)
      `, { count: 'exact' })
      .eq('company_id', ctx.profile.company_id)
      .order('created_at', { ascending: false })
      .range(offset, offset + query.limit - 1)

    if (query.status)      dbQuery = dbQuery.eq('status', query.status)
    if (query.priority)    dbQuery = dbQuery.eq('priority', query.priority)
    if (query.assigned_to) dbQuery = dbQuery.eq('assigned_to', query.assigned_to)
    if (query.search) {
      // Use ilike for broad compatibility (search_vector requires migration 004)
      dbQuery = dbQuery.or(
        `reference_number.ilike.%${query.search}%,notes.ilike.%${query.search}%`
      )
    }

    const { data: debts, count, error } = await dbQuery
    if (error) {
      log.error('Debt list query failed', error)
      return errors.internal()
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const debtsWithScore = (debts ?? []).map((d: Record<string, any>) => {
      const scores: Array<{ created_at: string }> = d.ai_scores ?? []
      const latest = scores.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0] ?? null
      return { ...d, ai_score: latest, ai_scores: undefined }
    })

    return NextResponse.json({
      data:  debtsWithScore,
      count,
      page:  query.page,
      limit: query.limit,
      pages: Math.ceil((count ?? 0) / query.limit),
    })
  })
}

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { data: body, error: parseErr } = await parseBody(request, createDebtSchema)
      if (parseErr) return parseErr

      const { data: customer } = await ctx.supabase
        .from('customers')
        .select('id')
        .eq('id', body.customer_id)
        .eq('company_id', ctx.profile.company_id)
        .single()

      if (!customer) return errors.notFound('Customer')

      if (body.assigned_to) {
        const { data: assignee } = await ctx.supabase
          .from('profiles')
          .select('id')
          .eq('id', body.assigned_to)
          .eq('company_id', ctx.profile.company_id)
          .single()
        if (!assignee) return errors.badRequest('Assigned user not found in your company')
      }

      const { data: debt, error: insertErr } = await ctx.supabase
        .from('debts')
        .insert({
          ...body,
          company_id:       ctx.profile.company_id,
          current_balance:  body.current_balance ?? body.original_amount,
          reference_number: generateReferenceNumber(),
          created_by:       ctx.user.id,
        })
        .select('*, customer:customers(id, full_name, phone)')
        .single()

      if (insertErr) {
        log.error('Debt insert failed', insertErr)
        if (insertErr.code === '23505') {
          return errors.conflict('Reference number conflict — please try again')
        }
        return errors.internal()
      }

      return NextResponse.json({ data: debt }, { status: 201 })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}

export async function DELETE(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const id = request.nextUrl.searchParams.get('id')
      if (!id) return errors.badRequest('id query parameter is required')

      const { data: debt } = await ctx.supabase
        .from('debts')
        .select('id, status')
        .eq('id', id)
        .eq('company_id', ctx.profile.company_id)
        .single()

      if (!debt) return errors.notFound('Debt')

      const debtRecord = debt as { id: string; status: string }
      if (debtRecord.status === 'settled') {
        return errors.conflict('Cannot delete settled debts. Use write-off status instead.')
      }

      const { error } = await ctx.supabase.from('debts').delete().eq('id', id)
      if (error) {
        log.error('Debt delete failed', error)
        return errors.internal()
      }

      return NextResponse.json({ data: { deleted: true } })
    },
    { requiredRoles: ['admin'] }
  )
}
