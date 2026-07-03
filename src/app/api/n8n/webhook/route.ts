import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { sendWhatsAppMessage } from '@/lib/whatsapp'
import { processEvent } from '@/lib/automation-pipeline'

/**
 * POST /api/n8n/webhook
 * 
 * Receives events from n8n workflows and processes them.
 * Events: message_received, payment_synced, status_updated, promise_due, campaign_sent, sync_completed
 */
export async function POST(request: NextRequest) {
  // Verify API key
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '')
  
  if (!apiKey || apiKey !== process.env.N8N_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { event, data, metadata } = body

    if (!event) {
      return NextResponse.json({ error: 'Missing event type' }, { status: 400 })
    }

    const supabase = createServiceClient()
    let result: Record<string, unknown> = {}

    switch (event) {
      // ── WhatsApp message received via Evolution API ──
      case 'message_received': {
        const { phone_number, message_content, message_type, instance_name, whatsapp_message_id } = data as Record<string, string>
        const company_id = metadata?.company_id

        if (!phone_number || !message_content || !company_id) {
          return NextResponse.json({ error: 'Missing required fields: phone_number, message_content, company_id' }, { status: 400 })
        }

        // Find customer by phone
        const { data: customer } = await supabase
          .from('customers')
          .select('id, full_name, company_id')
          .eq('company_id', company_id)
          .or(`phone.eq.${phone_number},whatsapp.eq.${phone_number}`)
          .maybeSingle()

        if (!customer) {
          // Log unknown number
          const { error: unknownAlertErr } = await supabase.from('system_alerts').insert({
            company_id,
            alert_type: 'unknown_number',
            severity: 'info',
            title: 'رسالة من رقم غير معروف',
            message: `رقم ${phone_number}: ${message_content.substring(0, 100)}`,
            metadata: { phone_number, instance_name },
          })
          if (unknownAlertErr) console.error('[n8n-webhook] unknown_number alert insert failed:', unknownAlertErr.message)

          result = { action: 'unknown_number', phone_number }
          break
        }

        // Save inbound message
        const { data: savedMessage, error: msgInsertErr } = await supabase.from('messages').insert({
          company_id,
          customer_id: customer.id,
          channel: 'whatsapp',
          direction: 'inbound',
          content: message_content,
          status: 'delivered',
          whatsapp_message_id,
          metadata: { instance_name, message_type: message_type || 'text' },
          sent_at: new Date().toISOString(),
        }).select('id').single()
        if (msgInsertErr) console.error('[n8n-webhook] inbound message insert failed:', msgInsertErr.message)

        result = { 
          action: 'message_saved', 
          message_id: savedMessage?.id,
          customer_id: customer.id,
          customer_name: customer.full_name,
        }
        break
      }

      // ── Payment synced from external system ──
      case 'payment_synced': {
        const { customer_id, debt_id, amount, payment_date, reference_number } = data as Record<string, string>
        const company_id = metadata?.company_id

        if (!company_id || !debt_id || !amount) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // The only auth here is one shared platform-wide N8N_WEBHOOK_SECRET —
        // if that secret ever leaks, a caller could otherwise record a fake
        // payment (and shrink the real balance) against ANY company's debt
        // by supplying a mismatched company_id/debt_id pair. Verify the debt
        // actually belongs to the claimed company before writing anything.
        const { data: debtOwnerCheck } = await supabase
          .from('debts').select('id').eq('id', debt_id).eq('company_id', company_id).maybeSingle()
        if (!debtOwnerCheck) {
          return NextResponse.json({ error: 'debt_id does not belong to company_id' }, { status: 403 })
        }

        // Insert payment
        const { data: payment, error: paymentInsertErr } = await supabase.from('payments').insert({
          company_id,
          customer_id,
          debt_id,
          amount: parseFloat(amount),
          payment_date: payment_date || new Date().toISOString(),
          reference_number,
          status: 'completed',
          notes: 'Synced via n8n',
        }).select('id').single()
        // Was silently discarded — a failed insert here means a real payment
        // never gets recorded (financial data loss) with zero trace, since
        // the caller (n8n) still gets an HTTP 200 either way.
        if (paymentInsertErr) console.error('[n8n-webhook] payment insert failed:', paymentInsertErr.message, { debt_id, amount })

        // Update debt balance. Real gap found during a deep follow-up audit:
        // update_debt_balance_after_payment was never actually deployed as a
        // DB function (confirmed — it doesn't exist in information_schema),
        // and the "update manually" fallback promised in the old comment was
        // never actually implemented — it just logged a warning and did
        // nothing. A payment synced via this route got its own `payments`
        // row, but the debt's current_balance never decreased. Now updates
        // directly, same working pattern already used in payment-receipt.ts.
        if (payment) {
          const { data: debtRow } = await supabase
            .from('debts').select('current_balance, status').eq('id', debt_id).maybeSingle()
          if (debtRow) {
            const newBal = Math.max(0, Number(debtRow.current_balance) - parseFloat(amount))
            const upd: Record<string, unknown> = { current_balance: newBal }
            if (newBal <= 0) upd.status = 'settled'
            else if (debtRow.status === 'promised' || debtRow.status === 'overdue') upd.status = 'active'
            const { error: balUpdErr } = await supabase.from('debts').update(upd).eq('id', debt_id)
            if (balUpdErr) console.error('[n8n-webhook] debt balance update failed:', balUpdErr.message, { debt_id })
          } else {
            console.error('[n8n-webhook] could not fetch debt for balance update', { debt_id })
          }
        }

        // Create alert
        const { error: paymentAlertErr } = await supabase.from('system_alerts').insert({
          company_id,
          alert_type: 'payment_received',
          severity: 'info',
          title: 'سداد جديد',
          message: `تم استلام سداد بمبلغ ${amount} ر.س`,
          metadata: { customer_id, debt_id, amount },
        })
        if (paymentAlertErr) console.error('[n8n-webhook] payment_received alert insert failed:', paymentAlertErr.message)

        result = { action: 'payment_saved', payment_id: payment?.id }
        break
      }

      // ── Status updated from external system ──
      case 'status_updated': {
        const { debt_id, customer_id, old_status, new_status, changed_by, source_system } = data as Record<string, string>
        const company_id = metadata?.company_id

        if (!company_id || !debt_id || !new_status) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        const { data: statusDebtOwnerCheck } = await supabase
          .from('debts').select('id').eq('id', debt_id).eq('company_id', company_id).maybeSingle()
        if (!statusDebtOwnerCheck) {
          return NextResponse.json({ error: 'debt_id does not belong to company_id' }, { status: 403 })
        }

        // Save to status history (dynamic status mapping)
        // Real gap found during a full-system audit: this is the ONLY write
        // in this branch and it was unchecked — a rejected insert means the
        // external status-change event vanishes with zero record anywhere,
        // while n8n still receives HTTP 200 and treats it as delivered.
        const { error: statusHistErr } = await supabase.from('collection_status_history').insert({
          company_id,
          customer_id,
          debt_id,
          old_status,
          new_status,
          normalized_status: new_status,
          changed_by_name: changed_by || 'n8n_sync',
          changed_at: new Date().toISOString(),
          source_system: source_system || 'collection_system',
        })
        if (statusHistErr) return NextResponse.json({ error: `status history insert failed: ${statusHistErr.message}` }, { status: 500 })

        result = { action: 'status_saved', debt_id, new_status }
        break
      }

      // ── AI reply generated (from n8n AI workflow) ──
      case 'ai_reply_generated': {
        const { customer_id, message_content, action_type, instance_name, phone_number, debt_id } = data as Record<string, string>
        const company_id = metadata?.company_id

        console.log('[ai_reply_generated] Received:', { customer_id, company_id, phone_number, action_type, message_content: message_content?.substring(0, 50) })

        if (!company_id || !customer_id || !message_content) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Same cross-tenant risk as payment_synced above — this branch sends
        // a real WhatsApp message and can change a debt's status, so a
        // mismatched customer_id/company_id pair must be rejected outright
        // rather than silently acting on whichever customer_id was supplied.
        const { data: customerOwnerCheck } = await supabase
          .from('customers').select('id').eq('id', customer_id).eq('company_id', company_id).maybeSingle()
        if (!customerOwnerCheck) {
          return NextResponse.json({ error: 'customer_id does not belong to company_id' }, { status: 403 })
        }

        let phone = phone_number
        let active_debt_id = debt_id

        if (!phone || !active_debt_id) {
          const { data: customerData } = await supabase
            .from('customers')
            .select('phone, whatsapp')
            .eq('id', customer_id)
            .single()

          console.log('[ai_reply_generated] Customer lookup:', customerData)
            
          phone = phone || customerData?.whatsapp || customerData?.phone

          if (!active_debt_id) {
            const { data: debtData } = await supabase
              .from('debts')
              .select('id')
              .eq('customer_id', customer_id)
              .eq('company_id', company_id)
              .in('status', ['active', 'promise_to_pay', 'disputed', 'escalated'])
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            active_debt_id = debtData?.id
          }
        }

        if (!phone) {
           console.error('[ai_reply_generated] No phone found for customer:', customer_id)
           return NextResponse.json({ error: 'Customer phone not found' }, { status: 404 })
        }

        // Send WhatsApp message directly via the WAHA gateway.
        console.log('[ai_reply_generated] Sending via WAHA:', { phone, messageLength: message_content.length })
        const waResult = await sendWhatsAppMessage({
          to: phone,
          message: message_content,
          company_id,
        })
        console.log('[ai_reply_generated] WAHA send result:', JSON.stringify(waResult))

        // Save outbound AI message
        const { error: aiReplyMsgErr } = await supabase.from('messages').insert({
          company_id,
          customer_id,
          debt_id: active_debt_id || null,
          channel: 'whatsapp',
          direction: 'outbound',
          content: message_content,
          status: waResult.status === 'sent' ? 'sent' : 'failed',
          whatsapp_message_id: waResult.message_id || null,
          metadata: { sender: 'ai', action_type, instance_name, error: waResult.error },
          sent_at: new Date().toISOString(),
        })
        if (aiReplyMsgErr) console.error('[ai_reply_generated] outbound message log failed:', aiReplyMsgErr.message)

        // Check if AI requested installment approval
        if (message_content.includes('موافقة') || message_content.includes('مراجعة') || message_content.includes('رفع طلب')) {
          console.log('[ai_reply_generated] Intercepted installment request from AI output')
          
          const { data: existingApproval } = await supabase
            .from('approvals')
            .select('id')
            .eq('company_id', company_id)
            .eq('entity_type', 'debt')
            .eq('entity_id', active_debt_id)
            .eq('status', 'pending')
            .in('approval_type', ['custom', 'payment_plan'])
            .maybeSingle()

          if (!existingApproval) {
            // 1. Create Approval Request
            const { error: approvalErr } = await supabase.from('approvals').insert({
              company_id,
              approval_type: 'custom',
              title: 'طلب موافقة على تقسيط',
              description: 'العميل يصر على التقسيط وتم إبلاغه برفع الطلب للإدارة.',
              entity_type: 'debt',
              entity_id: active_debt_id,
              status: 'pending',
              priority: 'high',
            })
            if (approvalErr) console.error('[ai_reply_generated] Failed to create approval:', approvalErr)
            
            // 2. Insert System Alert
            const { error: installmentAlertErr } = await supabase.from('system_alerts').insert({
              company_id,
              alert_type: 'installment_request',
              severity: 'warning',
              title: 'مطلوب موافقة تقسيط',
              message: `العميل يطلب تقسيط المديونية والموضوع بانتظار قرار الإدارة.`,
              metadata: { customer_id, debt_id: active_debt_id },
            })
            if (installmentAlertErr) console.error('[ai_reply_generated] installment_request alert insert failed:', installmentAlertErr.message)

            // 3. Update Debt status
            if (active_debt_id) {
              const { error: debtStatusErr } = await supabase.from('debts').update({ status: 'in_negotiation' }).eq('id', active_debt_id)
              if (debtStatusErr) console.error('[ai_reply_generated] debt status update failed:', debtStatusErr.message)

              // Add status history
              const { error: statusHistErr } = await supabase.from('collection_status_history').insert({
                company_id,
                customer_id,
                debt_id: active_debt_id,
                old_status: 'active',
                new_status: 'in_negotiation',
                normalized_status: 'in_negotiation',
                changed_by_name: 'AI Agent',
                changed_at: new Date().toISOString(),
                source_system: 'whatsapp_ai',
              })
              if (statusHistErr) console.error('[ai_reply_generated] collection_status_history insert failed:', statusHistErr.message)
            }
          } else {
            console.log('[ai_reply_generated] Pending approval already exists for this debt, skipping duplicate creation.')
          }
        }

        // Trigger dashboard and timeline updates
        processEvent({
          source: 'ai_reply',
          company_id,
          _customer_id: customer_id,
          _debt_id: active_debt_id || undefined,
          data: { action: action_type, message: message_content }
        }).catch(() => {})

        console.log('[ai_reply_generated] Pipeline complete. WA status:', waResult.status)
        result = { action: 'ai_reply_processed', customer_id, status: waResult.status }
        break
      }

      // ── Sync completed ──
      case 'sync_completed': {
        const { sync_type, records_processed, errors_count } = data as Record<string, string | number>
        const company_id = metadata?.company_id

        const { error: syncAlertErr } = await supabase.from('system_alerts').insert({
          company_id,
          alert_type: 'sync_completed',
          severity: Number(errors_count) > 0 ? 'warning' : 'info',
          title: 'مزامنة مكتملة',
          message: `نوع: ${sync_type} — تمت معالجة ${records_processed} سجل — أخطاء: ${errors_count}`,
          metadata: data,
        })
        if (syncAlertErr) console.error('[n8n-webhook] sync_completed alert insert failed:', syncAlertErr.message)

        result = { action: 'sync_logged' }
        break
      }

      // ── Campaign progress update ──
      case 'campaign_progress': {
        const { campaign_id, sent_count, delivered_count, failed_count } = data as Record<string, string | number>
        const company_id = metadata?.company_id

        if (campaign_id && company_id) {
          const { error: campaignProgressErr } = await supabase.from('campaigns')
            .update({
              sent_count: Number(sent_count) || 0,
              delivered_count: Number(delivered_count) || 0,
            })
            .eq('id', campaign_id)
            .eq('company_id', company_id)
          if (campaignProgressErr) console.error('[n8n-webhook] campaign_progress update failed:', campaignProgressErr.message)
        }

        result = { action: 'campaign_updated', campaign_id }
        break
      }

      default:
        return NextResponse.json({ error: `Unknown event: ${event}` }, { status: 400 })
    }

    return NextResponse.json({ success: true, event, ...result })
  } catch (error) {
    console.error('[n8n-webhook] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
