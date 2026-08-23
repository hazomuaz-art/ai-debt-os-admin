import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { errors, parseBody, withAuth } from '@/lib/api'
import { getN8nClient, normalizeN8nWebhookPath } from '@/lib/n8n/client'

const triggerSchema = z.object({
  webhookPath: z.string().min(1).max(200),
  event: z.string().min(1).max(100),
  data: z.record(z.unknown()),
})

/** Secure tenant-scoped proxy; n8n credentials never reach the browser. */
export async function POST(request: NextRequest) {
  return withAuth(async (ctx) => {
    const parsed = await parseBody(request, triggerSchema)
    if (parsed.error) return parsed.error

    const webhookPath = normalizeN8nWebhookPath(parsed.data.webhookPath)
    if (!webhookPath) return errors.badRequest('Invalid n8n webhook path')

    const result = await getN8nClient().triggerWebhook(webhookPath, {
      event: parsed.data.event,
      data: parsed.data.data,
      metadata: {
        company_id: ctx.profile.company_id,
        source: 'next-api-trigger',
      },
    })

    if (!result.success) return errors.internal('Failed to trigger n8n')
    return NextResponse.json({ success: true, data: result.data })
  }, { requiredRoles: ['admin', 'manager'] })
}
