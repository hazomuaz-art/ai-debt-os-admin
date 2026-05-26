import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'
import { rasfWhatsApp, tameezCalls, collectionApi } from '@/lib/integrations'
import type { IntegrationName } from '@/types'

const testSchema = z.object({
  integration_name: z.enum(['rasf_whatsapp', 'tameez_calls', 'collection_api']),
  config:           z.record(z.string()),
})

export async function POST(req: NextRequest) {
  return withAuth(
    async (_ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = testSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { integration_name, config } = parsed.data

      try {
        let result: { success: boolean; message: string; latency_ms?: number }

        const start = Date.now()

        if (integration_name === 'rasf_whatsapp') {
          result = await rasfWhatsApp.testConnection(config)
        } else if (integration_name === 'tameez_calls') {
          result = await tameezCalls.testConnection(config)
        } else {
          result = await collectionApi.testConnection(config)
        }

        return NextResponse.json({
          ...result,
          latency_ms: result.latency_ms ?? (Date.now() - start),
        })
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
