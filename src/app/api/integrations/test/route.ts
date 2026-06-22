import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'
import { rasfWhatsApp, tameezCalls, collectionApi } from '@/lib/integrations'

const testSchema = z.object({
  integration_name: z.string().min(1),
  config: z.record(z.any()),
})

export async function POST(req: NextRequest) {
  return withAuth(
    async (_ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = testSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { integration_name, config } = parsed.data
      const start = Date.now()

      try {
        if (integration_name === 'waha') {
          const baseUrl = String(config.api_url ?? '').replace(/\/$/, '')
          const apiKey = String(config.api_key ?? '')
          const session = String(config.session ?? 'default')

          if (!baseUrl || !apiKey) {
            return NextResponse.json(
              { success: false, message: 'Missing WAHA URL or API Key' },
              { status: 400 }
            )
          }

          const res = await fetch(`${baseUrl}/api/sessions/${session}`, {
            headers: { 'X-Api-Key': apiKey },
            cache: 'no-store',
          })

          if (!res.ok) {
            return NextResponse.json(
              { success: false, message: `WAHA API returned HTTP ${res.status}` },
              { status: 502 }
            )
          }

          const data = await res.json().catch(() => ({} as any))
          const connected = data?.status === 'WORKING'

          return NextResponse.json({
            success: connected,
            message: connected
              ? 'WAHA WhatsApp connected'
              : `WAHA session status: ${data?.status ?? 'unknown'}`,
            latency_ms: Date.now() - start,
          })
        }

        let result: { success: boolean; message: string; latency_ms?: number }

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
