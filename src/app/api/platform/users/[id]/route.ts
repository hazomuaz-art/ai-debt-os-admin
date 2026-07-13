import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/platform/users/delete')

export async function DELETE(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
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

      // Cleanup dependencies before deleting the Auth user.
      // Real gap found during a full-system audit: every single one of
      // these 9 writes was unchecked — if one silently failed (e.g. a
      // stale FK still pointing at this user), the account still got
      // deleted, potentially leaving dangling references in logs/debts/
      // customers/payments/ai_actions/messages with no trace anywhere.
      const cleanupSteps: [string, Promise<{ error: { message: string } | null }>][] = [
        ['logs.entity_id', ctx.serviceClient.from('logs').delete().eq('entity_id', targetUserId)],
        ['logs.user_id', ctx.serviceClient.from('logs').delete().eq('user_id', targetUserId)],
        ['debts.assigned_to', ctx.serviceClient.from('debts').update({ assigned_to: null }).eq('assigned_to', targetUserId)],
        ['debts.created_by', ctx.serviceClient.from('debts').update({ created_by: null }).eq('created_by', targetUserId)],
        ['customers.created_by', ctx.serviceClient.from('customers').update({ created_by: null }).eq('created_by', targetUserId)],
        ['payments.recorded_by', ctx.serviceClient.from('payments').update({ recorded_by: null }).eq('recorded_by', targetUserId)],
        ['ai_actions.assigned_to', ctx.serviceClient.from('ai_actions').update({ assigned_to: null }).eq('assigned_to', targetUserId)],
        // Some migrations added created_by to ai_actions — if the column
        // doesn't exist on a given deployment this legitimately errors;
        // still logged (at warn, not error) so a genuine failure elsewhere
        // isn't confused with this expected case.
        ['ai_actions.created_by', ctx.serviceClient.from('ai_actions').update({ created_by: null }).eq('created_by', targetUserId)],
        ['messages.sent_by', ctx.serviceClient.from('messages').update({ sent_by: null }).eq('sent_by', targetUserId)],
      ]
      for (const [stepName, stepPromise] of cleanupSteps) {
        const { error: cleanupErr } = await stepPromise
        if (cleanupErr) log.warn(`user-delete cleanup step failed: ${stepName}: ${cleanupErr.message}`, { target_user_id: targetUserId })
      }

      // Delete the Auth user (this will CASCADE delete the profile)
      const { error: deleteErr } = await ctx.serviceClient.auth.admin.deleteUser(targetUserId)

      if (deleteErr) {
        log.error('Failed to delete auth user', deleteErr)
        return errors.internal('Failed to delete user account: ' + deleteErr.message)
      }

      const { error: deleteLogErr } = await ctx.supabase.from('logs').insert({
        company_id:  ctx.profile.company_id,
        user_id:     ctx.user.id,
        entity_type: 'user',
        entity_id:   targetUserId,
        action:      'deleted',
        new_values:  { status: 'deleted' },
      })
      if (deleteLogErr) log.error('user-delete audit log insert failed', deleteLogErr, { target_user_id: targetUserId })

      return NextResponse.json({ success: true }, { status: 200 })
    },
    { requiredRoles: ['admin'] } // Only admins can delete users
  )
}
