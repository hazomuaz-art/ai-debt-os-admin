import { NextRequest, NextResponse } from 'next/server'
import { withAuth, parseBody, errors, inviteUserSchema } from '@/lib/api'
import { createLogger } from '@/lib/logger'
import { logSecurityEvent, extractRequestMeta } from '@/lib/security-audit'

const log = createLogger('api/auth/invite')

export async function POST(request: NextRequest) {
  return withAuth(
    async (ctx) => {
      const { data: body, error: parseErr } = await parseBody(request, inviteUserSchema)
      if (parseErr) return parseErr

      if (body.company_id !== ctx.profile.company_id) return errors.forbidden()

      const { data: existing } = await ctx.supabase
        .from('profiles')
        .select('id')
        .eq('email', body.email)
        .eq('company_id', ctx.profile.company_id)
        .maybeSingle()

      if (existing) {
        return errors.conflict('A user with this email already exists in your company')
      }

      const { data: newUser, error: createErr } = await ctx.serviceClient.auth.admin.createUser({
        email:         body.email,
        password:      body.password,
        email_confirm: true,
        user_metadata: { full_name: body.full_name, role: body.role },
      })

      if (createErr || !newUser.user) {
        const msg = createErr?.message ?? 'Failed to create user'
        if (msg.toLowerCase().includes('already registered')) {
          return errors.conflict('This email is already registered in the system')
        }
        log.error('Auth user creation failed', createErr)
        return errors.internal(msg)
      }

      const { error: profileErr } = await ctx.serviceClient
        .from('profiles')
        .update({
          company_id: ctx.profile.company_id,
          role:       body.role,
          full_name:  body.full_name,
          is_active:  false, // Changed to false: requires admin approval
        })
        .eq('id', newUser.user.id)

      if (profileErr) {
        await ctx.serviceClient.auth.admin.deleteUser(newUser.user.id)
        log.error('Profile update failed, user deleted', profileErr)
        return errors.internal('Failed to set up user profile')
      }

      const { error: logErr } = await ctx.supabase.from('logs').insert({
        company_id:  ctx.profile.company_id,
        user_id:     ctx.user.id,
        entity_type: 'user',
        entity_id:   newUser.user.id,
        action:      'invited',
        new_values:  { email: body.email, role: body.role, invited_by: ctx.user.id },
      })
      if (logErr) log.error('invite audit log insert failed', logErr, { invited_user_id: newUser.user.id })

      const { ip, userAgent } = extractRequestMeta(request)
      await logSecurityEvent({
        company_id: ctx.profile.company_id, actor_user_id: ctx.user.id, actor_email: ctx.user.email,
        event_type: 'user_invited', ip_address: ip, user_agent: userAgent,
        metadata: { invited_email: body.email, invited_role: body.role },
      })

      return NextResponse.json(
        { data: { id: newUser.user.id, email: body.email, role: body.role } },
        { status: 201 }
      )
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
