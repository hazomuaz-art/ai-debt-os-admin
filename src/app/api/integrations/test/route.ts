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
        if (integration_name === 'evolution_whatsapp') {
          const baseUrl = String(config.api_url ?? '').replace(/\/$/, '')
          const apiKey = String(config.api_key ?? '')
          const instanceName = String(config.instance_name ?? '')

          if (!baseUrl || !apiKey || !instanceName) {
            return NextResponse.json(
              { success: false, message: 'Missing Evolution URL, API Key, or Instance Name' },
              { status: 400 }
            )
          }

          const res = await fetch(`${baseUrl}/instance/fetchInstances`, {
            headers: { apikey: apiKey },
            cache: 'no-store',
          })

          if (!res.ok) {
            return NextResponse.json(
              { success: false, message: `Evolution API returned HTTP ${res.status}` },
              { status: 502 }
            )
          }

          const instances = await res.json()
          const found = Array.isArray(instances)
            ? instances.find((i: any) => i.name === instanceName)
            : null

          if (!found) {
            return NextResponse.json(
              { success: false, message: `Instance ${instanceName} not found` },
              { status: 404 }
            )
          }

          return NextResponse.json({
            success: found.connectionStatus === 'open',
            message: found.connectionStatus === 'open'
              ? 'Evolution WhatsApp connected'
              : `Evolution instance status: ${found.connectionStatus}`,
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
