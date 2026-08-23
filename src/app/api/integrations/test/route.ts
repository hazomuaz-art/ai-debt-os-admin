import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'
import { testIntegrationConnection } from '@/lib/integrations'
import { INTEGRATION_NAMES } from '@/lib/integration-catalog'

const testSchema = z.object({
  integration_name: z.enum(INTEGRATION_NAMES),
  config: z.record(z.string()),
})

export async function POST(req: NextRequest) {
  return withAuth(
    async () => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = testSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { integration_name, config } = parsed.data

      try {
        return NextResponse.json(await testIntegrationConnection(integration_name, config))
      } catch (err) {
        return NextResponse.json(
          { success: false, message: err instanceof Error ? err.message : 'Unknown error' },
          { status: 502 }
        )
      }
    },
    { requiredRoles: ['admin'] }
  )
}
