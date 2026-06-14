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
             const d = debtMap.get(a.entity_id)
             if (d && d.customers) {
               if (a.approval_type === 'custom' || a.approval_type === 'payment_plan') {
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
          if (approval.approval_type === 'payment_plan' || approval.approval_type === 'custom') {
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
            await ctx.supabase.from('debts').update({ status: newStatus }).eq('id', debtId)
            await ctx.supabase.from('collection_status_history').insert({
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
               await ctx.supabase.from('messages').insert({
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


