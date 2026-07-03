import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { z } from 'zod'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/legal-escalations')

const closeSchema = z.object({
  admin_notes: z.string().max(2000).optional().nullable(),
})

// The ONLY way the negotiation lock is lifted: an admin/manager explicitly
// closes the escalation. خالد itself never reopens negotiation on its own.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return withAuth(
    async (ctx) => {
      let body: unknown
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

      const parsed = closeSchema.safeParse(body)
      if (!parsed.success) return errors.validation(parsed.error)

      const { data: existing } = await ctx.supabase
        .from('legal_escalations')
        .select('id, debt_id, status')
        .eq('id', params.id)
        .eq('company_id', ctx.profile.company_id)
        .maybeSingle()
      if (!existing) return errors.notFound('Legal escalation')
      if (existing.status === 'closed') return errors.conflict('Escalation is already closed')

      const { data, error } = await ctx.supabase
        .from('legal_escalations')
        .update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: ctx.profile.id,
          admin_notes: parsed.data.admin_notes ?? null,
        })
        .eq('id', params.id)
        .select()
        .single()

      if (error) return errors.internal(error.message)

      // The negotiation lock in ai-collector-agent.ts checks ONLY
      // legal_escalations.status — closing it here is what actually lifts
      // the lock. Revert debts.status out of 'legal' too so other screens
      // (debt list/filters) reflect reality instead of staying stuck.
      // Real gap found during a full-system audit: unchecked — a rejected
      // update would leave the debt permanently stuck at status='legal'
      // (and thus permanently locked out of AI negotiation) even though the
      // escalation record itself shows closed.
      const { error: unlockErr } = await ctx.supabase.from('debts').update({ status: 'active' }).eq('id', existing.debt_id).eq('status', 'legal')
      if (unlockErr) log.error('failed to revert debt status after closing legal escalation', new Error(unlockErr.message), { debt_id: existing.debt_id })

      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}
