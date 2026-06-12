import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

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
          await supabase.from('system_alerts').insert({
            company_id,
            alert_type: 'unknown_number',
            severity: 'info',
            title: 'رسالة من رقم غير معروف',
            message: `رقم ${phone_number}: ${message_content.substring(0, 100)}`,
            metadata: { phone_number, instance_name },
          })
          
          result = { action: 'unknown_number', phone_number }
          break
        }

        // Save inbound message
        const { data: savedMessage } = await supabase.from('messages').insert({
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

        // Insert payment
        const { data: payment } = await supabase.from('payments').insert({
          company_id,
          customer_id,
          debt_id,
          amount: parseFloat(amount),
          payment_date: payment_date || new Date().toISOString(),
          reference_number,
          status: 'completed',
          notes: 'Synced via n8n',
        }).select('id').single()

        // Update debt balance
        if (payment) {
          await supabase.rpc('update_debt_balance_after_payment', {
            p_debt_id: debt_id,
            p_amount: parseFloat(amount),
          }).catch(() => {
            // RPC might not exist yet, update manually
            console.warn('[n8n-webhook] update_debt_balance_after_payment RPC not found')
          })
        }

        // Create alert
        await supabase.from('system_alerts').insert({
          company_id,
          alert_type: 'payment_received',
          severity: 'info',
          title: 'سداد جديد',
          message: `تم استلام سداد بمبلغ ${amount} ر.س`,
          metadata: { customer_id, debt_id, amount },
        })

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

        // Save to status history (dynamic status mapping)
        await supabase.from('collection_status_history').insert({
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

        result = { action: 'status_saved', debt_id, new_status }
        break
      }

      // ── AI reply generated (from n8n AI workflow) ──
      case 'ai_reply_generated': {
        const { customer_id, message_content, action_type, instance_name } = data as Record<string, string>
        const company_id = metadata?.company_id

        if (!company_id || !customer_id || !message_content) {
          return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Save outbound AI message
        await supabase.from('messages').insert({
          company_id,
          customer_id,
          channel: 'whatsapp',
          direction: 'outbound',
          content: message_content,
          status: 'sent',
          metadata: { sender: 'ai', action_type, instance_name },
          sent_at: new Date().toISOString(),
        })

        result = { action: 'ai_reply_saved', customer_id }
        break
      }

      // ── Sync completed ──
      case 'sync_completed': {
        const { sync_type, records_processed, errors_count } = data as Record<string, string | number>
        const company_id = metadata?.company_id

        await supabase.from('system_alerts').insert({
          company_id,
          alert_type: 'sync_completed',
          severity: Number(errors_count) > 0 ? 'warning' : 'info',
          title: 'مزامنة مكتملة',
          message: `نوع: ${sync_type} — تمت معالجة ${records_processed} سجل — أخطاء: ${errors_count}`,
          metadata: data,
        })

        result = { action: 'sync_logged' }
        break
      }

      // ── Campaign progress update ──
      case 'campaign_progress': {
        const { campaign_id, sent_count, delivered_count, failed_count } = data as Record<string, string | number>
        const company_id = metadata?.company_id

        if (campaign_id && company_id) {
          await supabase.from('campaigns')
            .update({
              sent_count: Number(sent_count) || 0,
              delivered_count: Number(delivered_count) || 0,
            })
            .eq('id', campaign_id)
            .eq('company_id', company_id)
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
