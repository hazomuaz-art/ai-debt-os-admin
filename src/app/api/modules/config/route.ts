import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

export async function GET(_req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { data, error } = await ctx.supabase
        .from('system_config')
        .select('*')
        .eq('company_id', ctx.profile.company_id)
        .maybeSingle()
      if (error) return errors.internal(error.message)
      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin'] }
  )
}

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: Record<string, unknown>
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const { data, error } = await ctx.supabase
        .from('system_config')
        .upsert({ ...body, company_id: ctx.profile.company_id }, { onConflict: 'company_id' })
        .select()
        .single()
      if (error) return errors.internal(error.message)
      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin'] }
  )
}
