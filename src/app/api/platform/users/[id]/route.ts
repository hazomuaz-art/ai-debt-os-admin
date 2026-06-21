import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/platform/users/delete')

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuth(
    async (ctx) => {
      const targetUserId = params.id
      if (!targetUserId) return errors.badRequest('Missing user id')

      if (targetUserId === ctx.user.id) {
        return errors.badRequest('You cannot delete your own account')
      }

      // Verify the target user belongs to the same company
      const { data: targetProfile, error: profileErr } = await ctx.supabase
        .from('profiles')
        .select('company_id')
        .eq('id', targetUserId)
        .single()

      if (profileErr || !targetProfile) {
        return errors.notFound('User not found')
      }

      if (targetProfile.company_id !== ctx.profile.company_id) {
        return errors.forbidden()
      }

      // Cleanup dependencies before deleting the Auth user
      // 1. Clear logs where this user is the entity or the actor
      await ctx.serviceClient.from('logs').delete().eq('entity_id', targetUserId)
      await ctx.serviceClient.from('logs').delete().eq('user_id', targetUserId)
      
      // 2. Clear debts assignments and creation
      await ctx.serviceClient.from('debts').update({ assigned_to: null }).eq('assigned_to', targetUserId)
      await ctx.serviceClient.from('debts').update({ created_by: null }).eq('created_by', targetUserId)
      
      // 3. Clear customer creation
      await ctx.serviceClient.from('customers').update({ created_by: null }).eq('created_by', targetUserId)
      
      // 4. Clear recorded payments
      await ctx.serviceClient.from('payments').update({ recorded_by: null }).eq('recorded_by', targetUserId)
      
      // 5. Clear assigned AI actions
      await ctx.serviceClient.from('ai_actions').update({ assigned_to: null }).eq('assigned_to', targetUserId)
      // Some migrations added created_by to ai_actions, let's try to clear it (if it doesn't exist, it just returns an error we ignore)
      await ctx.serviceClient.from('ai_actions').update({ created_by: null }).eq('created_by', targetUserId)
      
      // 6. Clear messages
      await ctx.serviceClient.from('messages').update({ sent_by: null }).eq('sent_by', targetUserId)

      // Delete the Auth user (this will CASCADE delete the profile)
      const { error: deleteErr } = await ctx.serviceClient.auth.admin.deleteUser(targetUserId)

      if (deleteErr) {
        log.error('Failed to delete auth user', deleteErr)
        return errors.internal('Failed to delete user account: ' + deleteErr.message)
      }

      await ctx.supabase.from('logs').insert({
        company_id:  ctx.profile.company_id,
        user_id:     ctx.user.id,
        entity_type: 'user',
        entity_id:   targetUserId,
        action:      'deleted',
        new_values:  { status: 'deleted' },
      })

      return NextResponse.json({ success: true }, { status: 200 })
    },
    { requiredRoles: ['admin'] } // Only admins can delete users
  )
}
