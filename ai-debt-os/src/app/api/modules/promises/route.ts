import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

export async function GET(_req: NextRequest) {
  return withAuth(async (ctx) => {
    const { data, error } = await ctx.supabase
      .from('promises')
      .select('*, customer:customers(full_name, phone), debt:debts(reference_number, current_balance, currency)')
      .eq('company_id', ctx.profile.company_id)
      .order('promised_date')
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data: data ?? [] })
  })
}

export async function POST(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }
    const { data, error } = await ctx.supabase
      .from('promises')
      .insert({ ...body, company_id: ctx.profile.company_id, collector_id: ctx.user.id })
      .select().single()
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data }, { status: 201 })
  })
}

export async function PATCH(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }
    const { id, ...rest } = body
    if (!id) return errors.badRequest('id required')
    const { data, error } = await ctx.supabase
      .from('promises').update(rest)
      .eq('id', String(id)).eq('company_id', ctx.profile.company_id)
      .select().single()
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data })
  })
}
