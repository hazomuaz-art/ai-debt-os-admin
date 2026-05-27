import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'

const settingsSchema = z.object({
  openai_input_per_1m:    z.coerce.number().min(0).max(100),
  openai_output_per_1m:   z.coerce.number().min(0).max(100),
  whatsapp_outbound:      z.coerce.number().min(0).max(10),
  whatsapp_inbound:       z.coerce.number().min(0).max(10),
  call_analysis_per_min:  z.coerce.number().min(0).max(10),
  storage_per_gb:         z.coerce.number().min(0).max(100),
  external_api_per_call:  z.coerce.number().min(0).max(10),
})

export async function GET(_req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { data, error } = await ctx.supabase
        .from('cost_settings')
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
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = settingsSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { data, error } = await ctx.supabase
        .from('cost_settings')
        .upsert(
          { ...parsed.data, company_id: ctx.profile.company_id },
          { onConflict: 'company_id' }
        )
        .select()
        .single()

      if (error) return errors.internal(error.message)
      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin'] }
  )
}
