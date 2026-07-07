import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

export async function GET(req: NextRequest) {
  return withAuth(async (ctx) => {
    // Resolved alerts used to be permanently invisible once cleared (no
    // history view at all) — found during a full-system audit. Default stays
    // unresolved-only; ?resolved=1 lets the page show what already got fixed.
    const showResolved = req.nextUrl.searchParams.get('resolved') === '1'
    const { data, error } = await ctx.supabase
      .from('system_alerts')
      .select('*')
      .or(`company_id.eq.${ctx.profile.company_id},company_id.is.null`)
      .eq('is_resolved', showResolved)
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

// DELETE one alert ({ id }) or all of this company's alerts ({ all: true })
export async function DELETE(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: { id?: string; all?: boolean }
    try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

    if (body.all) {
      const { error } = await ctx.supabase
        .from('system_alerts').delete()
        .eq('company_id', ctx.profile.company_id)
      if (error) return errors.internal(error.message)
      return NextResponse.json({ ok: true })
    }

    if (!body.id) return errors.badRequest('id or all required')
    const { error } = await ctx.supabase
      .from('system_alerts').delete()
      .eq('id', String(body.id))
      .or(`company_id.eq.${ctx.profile.company_id},company_id.is.null`)
    if (error) return errors.internal(error.message)
    return NextResponse.json({ ok: true })
  })
}
