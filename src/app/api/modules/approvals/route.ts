import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

export async function GET(_req: NextRequest) {
  return withAuth(async (ctx) => {
    const { data, error } = await ctx.supabase
      .from('approvals')
      .select('*, requester:profiles!approvals_requested_by_fkey(full_name)')
      .eq('company_id', ctx.profile.company_id)
      .order('created_at', { ascending: false })
      
    if (error) return errors.internal(error.message)
    
    let enrichedData = data ?? []
    
    const debtIds = enrichedData
      .filter(a => (a.entity_type === 'debt' || a.entity_type === 'debts') && a.entity_id)
      .map(a => a.entity_id)
      
    if (debtIds.length > 0) {
      const { data: debts } = await ctx.supabase
        .from('debts')
        .select('id, current_balance, currency, customers(full_name)')
        .in('id', debtIds)
        
      if (debts) {
        const debtMap = new Map(debts.map(d => [d.id, d]))
        enrichedData = enrichedData.map(a => {
          if ((a.entity_type === 'debt' || a.entity_type === 'debts') && a.entity_id) {
             const d: any = debtMap.get(a.entity_id)
             if (d && d.customers) {
               // approval_type alone can no longer distinguish an
               // installment request from a dispute or any other custom
               // approval — both now correctly use approval_type='custom'
               // (the only valid value either could ever use against the
               // real CHECK constraint). requested_data.request_subtype is
               // the actual distinguishing field now.
               if (a.requested_data?.request_subtype === 'installment') {
                 a.title = `طلب تقسيط: ${d.customers.full_name}`
                 a.description = `العميل يطلب التقسيط لمديونية بقيمة ${d.current_balance} ${d.currency}`
               }
             }
          }
          return a
        })
      }
    }
    
    return NextResponse.json({ data: enrichedData })
  })
}

export async function POST(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: Record<string, unknown>
    try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }
    const { data, error } = await ctx.supabase
      .from('approvals')
      .insert({ ...body, company_id: ctx.profile.company_id, requested_by: ctx.user.id })
      .select().single()
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data }, { status: 201 })
  })
}

export async function PATCH(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      let body: Record<string, unknown>
      try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }
      const { id, status, paymentPlan, ...rest } = body as any
      if (!id || !status) return errors.badRequest('id and status required')
      
      const { data: approval, error: fetchErr } = await ctx.supabase
        .from('approvals')
        .select('*')
        .eq('id', String(id)).eq('company_id', ctx.profile.company_id)
        .single()
        
      if (fetchErr || !approval) return errors.notFound('Approval not found')

      const updatePayload: any = { status, ...rest, reviewed_by: ctx.user.id, updated_at: new Date().toISOString() }
      if (paymentPlan && status === 'approved') {
        updatePayload.review_notes = `خطة التقسيط المعتمدة: ${paymentPlan.count} أقساط ${paymentPlan.frequency}، الدفعة الأولى: ${paymentPlan.firstPayment}`
      }

      const { data, error } = await ctx.supabase
        .from('approvals')
        .update(updatePayload)
        .eq('id', String(id)).eq('company_id', ctx.profile.company_id)
        .select().single()
        
      if (error) return errors.internal(error.message)

      // Post-decision automation
      try {
        if ((approval.entity_type === 'debts' || approval.entity_type === 'debt') && approval.entity_id) {
          // Same reasoning as the GET handler above — approval_type is
          // 'custom' for both installment requests and disputes now (it's
          // the only valid value either can use), so the actual branch
          // must come from requested_data.request_subtype instead.
          if (approval.requested_data?.request_subtype === 'installment') {
            const debtId = approval.entity_id
          
          // Fetch debt and customer info
          const { data: debtInfo } = await ctx.supabase
            .from('debts')
            .select('*, customers(id, phone, whatsapp, full_name)')
            .eq('id', debtId)
            .single()
            
          if (debtInfo && debtInfo.customers) {
            const phone = debtInfo.customers.whatsapp || debtInfo.customers.phone
            const newStatus = status === 'approved' ? 'payment_plan' : 'active'
            
            // Update debt status
            const { error: installmentStatusErr } = await ctx.supabase.from('debts').update({ status: newStatus }).eq('id', debtId)
            if (installmentStatusErr) console.error('[approvals PATCH] installment debt status update failed:', installmentStatusErr.message)
            const { error: installmentHistErr } = await ctx.supabase.from('collection_status_history').insert({
              company_id: ctx.profile.company_id,
              customer_id: debtInfo.customers.id,
              debt_id: debtId,
              old_status: debtInfo.status,
              new_status: newStatus,
              normalized_status: newStatus,
              changed_by_name: ctx.profile.full_name || 'Admin',
              changed_at: new Date().toISOString(),
              source_system: 'approvals_dashboard',
            })
            if (installmentHistErr) console.error('[approvals PATCH] installment status history insert failed:', installmentHistErr.message)
            
            // Send WhatsApp Notification
            if (phone) {
               let message = ''
               if (status === 'approved') {
                 if (paymentPlan && paymentPlan.count && paymentPlan.frequency && paymentPlan.firstPayment) {
                   message = `مرحباً ${debtInfo.customers.full_name}، تمت الموافقة من الإدارة على طلبك لتقسيط المديونية (${debtInfo.current_balance} ${debtInfo.currency}). خطة التقسيط المعتمدة هي: ${paymentPlan.count} أقساط ${paymentPlan.frequency}، ومطلوب سداد دفعة أولى بقيمة ${paymentPlan.firstPayment} ${debtInfo.currency}. يرجى السداد لتفعيل الخطة.`
                 } else {
                   message = `مرحباً ${debtInfo.customers.full_name}، تمت الموافقة من الإدارة على طلبك لتقسيط المديونية (${debtInfo.current_balance} ${debtInfo.currency}). يرجى إبلاغنا بالدفعة المقدمة التي تستطيع دفعها الآن للبدء.`
                 }
               } else {
                 message = `مرحباً ${debtInfo.customers.full_name}، نعتذر، تم رفض طلب التقسيط من قبل الإدارة. يرجى سداد كامل الرصيد المستحق (${debtInfo.current_balance} ${debtInfo.currency}) تفادياً لتصعيد المطالبة.`
               }
                  
               // We need to import sendWhatsAppMessage
               // Since we can't easily import it here if it's not already imported, we'll import it dynamically or at the top
               const { sendWhatsAppMessage } = await import('@/lib/whatsapp')
               const waResult = await sendWhatsAppMessage({ to: phone, message, company_id: ctx.profile.company_id })
               
               // Save message to history
               const { error: approvalMsgErr } = await ctx.supabase.from('messages').insert({
                  company_id: ctx.profile.company_id,
                  customer_id: debtInfo.customers.id,
                  debt_id: debtId,
                  channel: 'whatsapp',
                  direction: 'outbound',
                  content: message,
                  status: waResult.status === 'sent' ? 'sent' : 'failed',
                  whatsapp_message_id: waResult.message_id || null,
                  metadata: { sender: 'admin', action_type: 'approval_notification', error: waResult.error },
                  sent_at: new Date().toISOString(),
               })
               if (approvalMsgErr) console.error('[approvals PATCH] installment notification message log failed:', approvalMsgErr.message)
            }
          }
          }

          // ── Dispute decision automation ──
          // approval.approval_type === 'dispute' could NEVER match (not a
          // valid approval_type — see dispute.ts) — this whole branch has
          // been unreachable dead code since it was written; no dispute
          // decision has ever actually triggered a customer notification
          // or resolved the underlying dispute record. Fixed to check the
          // real distinguishing field.
          if (approval.requested_data?.request_subtype === 'dispute') {
            const debtId = approval.entity_id
            const { data: di } = await ctx.supabase
              .from('debts').select('*, customers(id, phone, whatsapp, full_name)').eq('id', debtId).single()
            if (di && di.customers) {
              const phone = di.customers.whatsapp || di.customers.phone
              const accepted = status === 'approved'
              // Accepted dispute → mark disputed + hand to human; rejected → resume collection
              const { error: disputeDebtErr } = await ctx.supabase.from('debts').update({ status: accepted ? 'disputed' : 'active' }).eq('id', debtId)
              if (disputeDebtErr) console.error('[approvals PATCH] dispute debt status update failed:', disputeDebtErr.message)
              const { error: disputePauseErr } = await ctx.supabase.from('customers').update({ ai_paused: accepted }).eq('id', di.customers.id)
              if (disputePauseErr) console.error('[approvals PATCH] dispute ai_paused update failed:', disputePauseErr.message)
              // 'accepted' was never a valid disputes.status (the real
              // CHECK constraint is open/under_review/resolved/rejected/
              // escalated) — 'resolved' is the correct value; this update
              // also failed silently before, on top of the branch never
              // being reached at all.
              const { error: disputeRecordErr } = await ctx.supabase.from('disputes')
                .update({ status: accepted ? 'resolved' : 'rejected', resolved_by: ctx.user.id, resolved_at: new Date().toISOString() })
                .eq('debt_id', debtId).eq('status', 'open')
              if (disputeRecordErr) console.error('[approvals PATCH] disputes record update failed:', disputeRecordErr.message)
              if (phone) {
                const message = accepted
                  ? `مرحباً ${di.customers.full_name}، تمت دراسة اعتراضك وقبوله مبدئياً. تم تعليق المطالبة الآلية وسيتواصل معك موظف مختص لاستكمال المراجعة.`
                  : `مرحباً ${di.customers.full_name}، راجعنا اعتراضك ولم يثبت ما يلغي المديونية. يرجى سداد الرصيد المستحق (${di.current_balance} ${di.currency}) أو التواصل لترتيب حل.`
                const { sendWhatsAppMessage } = await import('@/lib/whatsapp')
                const wr = await sendWhatsAppMessage({ to: phone, message, company_id: ctx.profile.company_id })
                const { error: disputeMsgErr } = await ctx.supabase.from('messages').insert({
                  company_id: ctx.profile.company_id, customer_id: di.customers.id, debt_id: debtId,
                  channel: 'whatsapp', direction: 'outbound', content: message,
                  status: wr.status === 'sent' ? 'sent' : 'failed', whatsapp_message_id: wr.message_id || null,
                  metadata: { sender: 'admin', action_type: 'dispute_decision', error: wr.error }, sent_at: new Date().toISOString(),
                })
                if (disputeMsgErr) console.error('[approvals PATCH] dispute decision message log failed:', disputeMsgErr.message)
              }
            }
          }
        }
      } catch (err) {
        console.error('[approvals PATCH] Post-decision automation failed:', err)
      }
      
      return NextResponse.json({ data })
    },
    { requiredRoles: ['admin', 'manager'] }
  )
}


