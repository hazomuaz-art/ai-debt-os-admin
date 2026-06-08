import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'

const saveSchema = z.object({
  integration_name: z.string().min(1),
  enabled:          z.boolean(),
  config: z.record(z.any()),
})

export async function GET(_req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { data, error } = await ctx.supabase
        .from('integration_settings')
        .select('*')
        .eq('company_id', ctx.profile.company_id)
        .order('integration_name')

      if (error) return errors.internal(error.message)
      return NextResponse.json({ data: data ?? [] })
    },
    { requiredRoles: ['admin'] }
  )
}

export async function POST(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = saveSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { integration_name, enabled, config } = parsed.data

      const { data, error } = await ctx.supabase
        .from('integration_settings')
        .upsert(
          { company_id: ctx.profile.company_id, integration_name, enabled, config },
          { onConflict: 'company_id,integration_name' }
        )
        .select()
        .single()

      if (error) return errors.internal(error.message)
      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin'] }
  )
}


