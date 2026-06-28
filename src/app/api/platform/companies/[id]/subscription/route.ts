import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

// PATCH /api/platform/companies/:id/subscription  { action: 'activate' | 'suspend', reason?: string }
// Calls the existing activate_company()/suspend_company() DB functions
// (added in migration 017, never had an API route or UI until now).
// Cross-tenant by design (manages ANY company's subscription) — restricted
// to the platform owner, same gate as the platform/companies pages.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuth(async (ctx) => {
    if (ctx.profile.company_id !== process.env.PLATFORM_OWNER_COMPANY_ID) {
      return errors.forbidden()
    }

    const body = await req.json().catch(() => null)
    if (!body || !['activate', 'suspend'].includes(body.action)) {
      return errors.badRequest('action must be "activate" or "suspend"')
    }

    const fn = body.action === 'activate' ? 'activate_company' : 'suspend_company'
    const rpcArgs = body.action === 'activate'
      ? { p_company_id: params.id, p_actor_id: ctx.user.id }
      : { p_company_id: params.id, p_actor_id: ctx.user.id, p_reason: body.reason ?? null }

    const { error } = await ctx.serviceClient.rpc(fn, rpcArgs)
    if (error) return errors.internal(error.message)

    return NextResponse.json({ success: true, action: body.action })
  }, { requiredRoles: ['admin'] })
}
