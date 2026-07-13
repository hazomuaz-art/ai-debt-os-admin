import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { logSecurityEvent, extractRequestMeta } from '@/lib/security-audit'

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAuth(
    async (ctx) => {
      const body = await request.json().catch(() => null)

      if (!body || !['manager','collector'].includes(body.role)) {
        return errors.badRequest('Invalid role')
      }

      const userId = params.id

      const { data: targetUser, error: targetErr } =
        await ctx.serviceClient
          .from('profiles')
          .select('id, company_id, role, email')
          .eq('id', userId)
          .single()

      if (targetErr || !targetUser) {
        return errors.notFound('User not found')
      }

      if (targetUser.company_id !== ctx.profile.company_id) {
        return errors.forbidden()
      }

      const { error: updateErr } =
        await ctx.serviceClient
          .from('profiles')
          .update({ role: body.role })
          .eq('id', userId)

      if (updateErr) {
        return errors.internal('Failed to update role')
      }

      const { ip, userAgent } = extractRequestMeta(request)
      await logSecurityEvent({
        company_id: ctx.profile.company_id, actor_user_id: ctx.user.id, actor_email: ctx.user.email,
        event_type: 'role_changed', ip_address: ip, user_agent: userAgent,
        metadata: { target_user_id: userId, target_email: targetUser.email, old_role: targetUser.role, new_role: body.role },
      })

      return NextResponse.json({
        data: {
          id: userId,
          role: body.role,
        },
      })
    },
    { requiredRoles: ['admin'] }
  )
}
