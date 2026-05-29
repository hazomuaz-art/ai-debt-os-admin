import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

export async function GET(req: NextRequest) {
  return withAuth(async (ctx) => {
    const customerId = req.nextUrl.searchParams.get('customer_id')
    if (!customerId) return errors.badRequest('customer_id required')
    const { data, error } = await ctx.supabase
      .from('timeline_events')
      .select('*')
      .eq('company_id', ctx.profile.company_id)
      .eq('customer_id', customerId)
      .order('occurred_at', { ascending: false })
      .limit(100)
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data: data ?? [] })
  })
}

export async function POST(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }
    const { data, error } = await ctx.supabase
      .from('timeline_events')
      .insert({ ...body, company_id: ctx.profile.company_id })
      .select().single()
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data }, { status: 201 })
  })
}
