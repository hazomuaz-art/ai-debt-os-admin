import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

export async function GET(_req: NextRequest) {
  return withAuth(async (ctx) => {
    const { data, error } = await ctx.supabase
      .from('system_alerts')
      .select('*')
      .or(`company_id.eq.${ctx.profile.company_id},company_id.is.null`)
      .eq('is_resolved', false)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data: data ?? [] })
  })
}

export async function PATCH(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }
    const { id, ...rest } = body
    if (!id) return errors.badRequest('id required')
    const { data, error } = await ctx.supabase
      .from('system_alerts').update(rest)
      .eq('id', String(id))
      .select().single()
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data })
  })
}
