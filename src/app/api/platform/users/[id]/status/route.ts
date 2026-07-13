import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { createLogger } from '@/lib/logger'
import { logSecurityEvent, extractRequestMeta } from '@/lib/security-audit'

const log = createLogger('api/platform/users/status')

export async function PATCH(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAuth(
    async (ctx) => {
      const body = await request.json().catch(() => null)

      if (!body || typeof body.is_active !== 'boolean') {
        return errors.badRequest('is_active must be boolean')
      }

      const userId = params.id

      const { data: targetUser, error: targetErr } = await ctx.serviceClient
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

      if (targetUser.id === ctx.user.id) {
        return errors.badRequest('You cannot change your own status')
      }

      const { error: updateErr } = await ctx.serviceClient
        .from('profiles')
        .update({ is_active: body.is_active })
        .eq('id', userId)

      if (updateErr) {
        return errors.internal('Failed to update user status')
      }

      const { error: statusLogErr } = await ctx.serviceClient.from('logs').insert({
        company_id: ctx.profile.company_id,
        user_id: ctx.user.id,
        entity_type: 'user',
        entity_id: userId,
        action: body.is_active ? 'enabled' : 'disabled',
        new_values: {
          target_email: targetUser.email,
          is_active: body.is_active,
        },
      })
      if (statusLogErr) log.error('user status-change audit log insert failed', statusLogErr, { target_user_id: userId })

      const { ip, userAgent } = extractRequestMeta(request)
      await logSecurityEvent({
        company_id: ctx.profile.company_id, actor_user_id: ctx.user.id, actor_email: ctx.user.email,
        event_type: body.is_active ? 'user_activated' : 'user_deactivated',
        ip_address: ip, user_agent: userAgent,
        metadata: { target_user_id: userId, target_email: targetUser.email },
      })

      return NextResponse.json({
        data: {
          id: userId,
          is_active: body.is_active,
        },
      })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
