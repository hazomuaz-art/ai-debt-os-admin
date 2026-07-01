import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processEvent } from '@/lib/automation-pipeline'
import { createLogger } from '@/lib/logger'

const log = createLogger('api/sync/collection')

type IncomingPayload = {
  event_type?: string
  company_id?: string
  source_system?: string
  external_customer_id?: string
  external_debt_id?: string
  external_case_id?: string
  source_updated_at?: string

  customer?: {
    external_customer_id?: string
    full_name?: string
    phone?: string
    whatsapp?: string
    national_id?: string
    city?: string
    employer?: string
    monthly_income?: number
    notes?: string
    raw_payload?: Record<string, unknown>
  }

  debt?: {
    external_debt_id?: string
    external_case_id?: string
    reference_number?: string
    account_number?: string
    original_amount?: number
    current_balance?: number
    currency?: string
    status?: string
    sub_status?: string
    status_code?: string
    normalized_status?: string
    priority?: string
    due_date?: string
    product_type?: string
    creditor_name?: string
    notes?: string
    raw_payload?: Record<string, unknown>
  }

  remark?: string

  payment?: {
    amount?: number
    currency?: string
    payment_date?: string
    reference_number?: string
    status?: string
    notes?: string
    receipt_url?: string
  }

  followups?: Array<{
    external_followup_id?: string
    followup_type?: string
    followup_channel?: string
    original_status?: string
    original_sub_status?: string
    normalized_status?: string
    collector_name?: string
    collector_external_id?: string
    customer_statement?: string
    collector_note?: string
    result_summary?: string
    next_follow_up_at?: string
    occurred_at?: string
    raw_payload?: Record<string, unknown>
  }>

  status_history?: Array<{
    external_status_id?: string
    old_status?: string
    old_sub_status?: string
    new_status?: string
    new_sub_status?: string
    normalized_status?: string
    changed_by_name?: string
    changed_by_external_id?: string
    changed_at?: string
    raw_payload?: Record<string, unknown>
  }>

  assignments?: Array<{
    external_assignment_id?: string
    assigned_to_name?: string
    assigned_to_external_id?: string
    assigned_by_name?: string
    assigned_by_external_id?: string
    assignment_status?: string
    assigned_at?: string
    released_at?: string
    raw_payload?: Record<string, unknown>
  }>

  attachments?: Array<{
    external_attachment_id?: string
    attachment_type?: string
    file_name?: string
    file_url?: string
    mime_type?: string
    uploaded_by_name?: string
    uploaded_at?: string
    description?: string
    raw_payload?: Record<string, unknown>
  }>

  status_mapping?: {
    original_status?: string
    original_sub_status?: string
    original_status_code?: string
    normalized_status?: string
    normalized_category?: string
    ai_meaning?: string
    recommended_strategy?: string
    is_terminal?: boolean
    priority_weight?: number
    metadata?: Record<string, unknown>
  }
}

function cleanPhone(v?: string) {
  return String(v ?? '').replace(/\D/g, '')
}

function hashPayload(value: unknown) {
  const text = JSON.stringify(value ?? {})
  let hash = 0
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i)
    hash |= 0
  }
  return String(hash)
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as IncomingPayload
    const sb = createServiceClient()
    const sourceSystem = payload.source_system || 'collection_system'

    const companyId =
      payload.company_id ||
      process.env.DEFAULT_COMPANY_ID ||
      process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID

    if (!companyId) {
      return NextResponse.json(
        { success: false, error: 'company_id required or DEFAULT_COMPANY_ID missing' },
        { status: 400 }
      )
    }

    // Previously the ONLY "auth" was company_id inside the request body
    // itself — anyone who could reach this URL and supply/guess a real
    // company_id could write debts/customers/payments for that company
    // using the full service-role client. Verify against that company's
    // own collection_api token (the same credential configured in
    // /dashboard/admin/integrations for outbound calls — reused here to
    // authenticate inbound ones, since there is no separate secret field).
    const apiKey = req.headers.get('x-api-key') || req.headers.get('authorization')?.replace('Bearer ', '')
    const { data: integ } = await sb.from('integration_settings')
      .select('config').eq('company_id', companyId).eq('integration_name', 'collection_api').maybeSingle()
    const expectedToken = (integ?.config as Record<string, string> | undefined)?.token
    if (!expectedToken || !apiKey || apiKey !== expectedToken) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    if (!payload.customer?.full_name && !payload.customer?.phone && !payload.customer?.whatsapp && !payload.customer?.national_id && !payload.external_customer_id) {
      return NextResponse.json(
        { success: false, error: 'customer full_name, phone, whatsapp, national_id, or external_customer_id required' },
        { status: 400 }
      )
    }

    const phone = cleanPhone(payload.customer?.phone)
    const whatsapp = cleanPhone(payload.customer?.whatsapp)
    const externalCustomerId = payload.customer?.external_customer_id || payload.external_customer_id || null
    const externalDebtId = payload.debt?.external_debt_id || payload.external_debt_id || null
    const externalCaseId = payload.debt?.external_case_id || payload.external_case_id || null

    let customerId: string | null = null

    if (externalCustomerId) {
      const { data } = await sb.from('customers')
        .select('id')
        .eq('company_id', companyId)
        .eq('external_customer_id', externalCustomerId)
        .maybeSingle()
      customerId = data?.id ?? null
    }

    if (!customerId && payload.customer?.national_id) {
      const { data } = await sb.from('customers')
        .select('id')
        .eq('company_id', companyId)
        .eq('national_id', payload.customer.national_id)
        .maybeSingle()
      customerId = data?.id ?? null
    }

    // Exact match, not substring (`ilike %phone%`) — a partial/substring match
    // could match a DIFFERENT existing customer whose number happens to
    // contain this one as a digit sequence, silently overwriting the wrong
    // customer's record on sync.
    if (!customerId && phone) {
      const { data } = await sb.from('customers')
        .select('id')
        .eq('company_id', companyId)
        .eq('phone', phone)
        .maybeSingle()
      customerId = data?.id ?? null
    }

    if (!customerId && whatsapp) {
      const { data } = await sb.from('customers')
        .select('id')
        .eq('company_id', companyId)
        .eq('whatsapp', whatsapp)
        .maybeSingle()
      customerId = data?.id ?? null
    }

    if (!customerId) {
      const { data, error } = await sb.from('customers')
        .insert({
          company_id: companyId,
          external_customer_id: externalCustomerId,
          full_name: payload.customer?.full_name || 'Unknown Customer',
          phone: phone || null,
          whatsapp: whatsapp || phone || null,
          national_id: payload.customer?.national_id || null,
          city: payload.customer?.city || null,
          employer: payload.customer?.employer || null,
          monthly_income: payload.customer?.monthly_income ?? null,
          notes: payload.customer?.notes || null,
          country: 'SA',
          risk_level: 'medium',
          tags: [],
          source_payload: payload.customer?.raw_payload || payload.customer || {},
          last_source_synced_at: new Date().toISOString(),
          metadata: { source: sourceSystem },
        })
        .select('id')
        .single()

      if (error) throw error
      customerId = data.id
    } else {
      await sb.from('customers')
        .update({
          external_customer_id: externalCustomerId || undefined,
          full_name: payload.customer?.full_name || undefined,
          phone: phone || undefined,
          whatsapp: whatsapp || undefined,
          city: payload.customer?.city || undefined,
          employer: payload.customer?.employer || undefined,
          monthly_income: payload.customer?.monthly_income ?? undefined,
          source_payload: payload.customer?.raw_payload || payload.customer || undefined,
          last_source_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)
        .eq('company_id', companyId)
    }

    let debtId: string | null = null

    if (externalDebtId) {
      const { data } = await sb.from('debts')
        .select('id')
        .eq('company_id', companyId)
        .eq('external_ref', externalDebtId)
        .maybeSingle()
      debtId = data?.id ?? null
    }

    if (!debtId && payload.debt?.reference_number) {
      const { data } = await sb.from('debts')
        .select('id')
        .eq('company_id', companyId)
        .eq('reference_number', payload.debt.reference_number)
        .maybeSingle()
      debtId = data?.id ?? null
    }

    if (!debtId && payload.debt?.account_number) {
      const { data } = await sb.from('debts')
        .select('id')
        .eq('company_id', companyId)
        .eq('account_number', payload.debt.account_number)
        .maybeSingle()
      debtId = data?.id ?? null
    }

    if (payload.debt && !debtId) {
      const { data, error } = await sb.from('debts')
        .insert({
          company_id: companyId,
          customer_id: customerId,
          external_ref: externalDebtId,
          external_customer_id: externalCustomerId,
          external_case_id: externalCaseId,
          reference_number: payload.debt.reference_number || externalDebtId || `SYNC-${Date.now()}`,
          account_number: payload.debt.account_number || null,
          original_amount: payload.debt.original_amount ?? payload.debt.current_balance ?? 0,
          current_balance: payload.debt.current_balance ?? payload.debt.original_amount ?? 0,
          currency: payload.debt.currency || 'SAR',
          status: payload.debt.normalized_status || payload.debt.status || 'active',
          original_status: payload.debt.status || null,
          original_sub_status: payload.debt.sub_status || null,
          original_status_code: payload.debt.status_code || null,
          normalized_status: payload.debt.normalized_status || payload.debt.status || 'active',
          priority: payload.debt.priority || 'medium',
          due_date: payload.debt.due_date || null,
          product_type: payload.debt.product_type || null,
          creditor_name: payload.debt.creditor_name || null,
          notes: payload.debt.notes || null,
          source_payload: payload.debt.raw_payload || payload.debt || {},
          last_source_synced_at: new Date().toISOString(),
          interest_rate: 0,
          penalty_amount: 0,
          metadata: { source: sourceSystem },
        })
        .select('id')
        .single()

      if (error) throw error
      debtId = data.id
    } else if (payload.debt && debtId) {
      await sb.from('debts')
        .update({
          external_ref: externalDebtId || undefined,
          external_customer_id: externalCustomerId || undefined,
          external_case_id: externalCaseId || undefined,
          current_balance: payload.debt.current_balance ?? undefined,
          status: payload.debt.normalized_status || payload.debt.status || undefined,
          original_status: payload.debt.status || undefined,
          original_sub_status: payload.debt.sub_status || undefined,
          original_status_code: payload.debt.status_code || undefined,
          normalized_status: payload.debt.normalized_status || payload.debt.status || undefined,
          priority: payload.debt.priority || undefined,
          due_date: payload.debt.due_date || undefined,
          creditor_name: payload.debt.creditor_name || undefined,
          product_type: payload.debt.product_type || undefined,
          notes: payload.debt.notes || undefined,
          source_payload: payload.debt.raw_payload || payload.debt || undefined,
          last_source_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', debtId)
        .eq('company_id', companyId)
    }

    if (payload.status_mapping?.original_status) {
      await sb.from('collection_status_mappings').upsert({
        company_id: companyId,
        source_system: sourceSystem,
        original_status: payload.status_mapping.original_status,
        original_sub_status: payload.status_mapping.original_sub_status || null,
        original_status_code: payload.status_mapping.original_status_code || null,
        normalized_status: payload.status_mapping.normalized_status || 'active',
        normalized_category: payload.status_mapping.normalized_category || 'unknown',
        ai_meaning: payload.status_mapping.ai_meaning || null,
        recommended_strategy: payload.status_mapping.recommended_strategy || null,
        is_terminal: payload.status_mapping.is_terminal ?? false,
        priority_weight: payload.status_mapping.priority_weight ?? 0,
        metadata: payload.status_mapping.metadata || {},
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'company_id,portfolio_id,source_system,original_status,original_sub_status,original_status_code',
      })
    }

    if (payload.payment && debtId) {
      await sb.from('payments').insert({
        company_id: companyId,
        customer_id: customerId,
        debt_id: debtId,
        amount: payload.payment.amount ?? 0,
        currency: payload.payment.currency || payload.debt?.currency || 'SAR',
        payment_date: payload.payment.payment_date || new Date().toISOString().slice(0, 10),
        reference_number: payload.payment.reference_number || null,
        status: payload.payment.status || 'completed',
        notes: payload.payment.notes || null,
        receipt_url: payload.payment.receipt_url || null,
      })
    }

    if (payload.followups?.length) {
      for (const item of payload.followups) {
        await sb.from('collection_followups').upsert({
          company_id: companyId,
          customer_id: customerId,
          debt_id: debtId,
          source_system: sourceSystem,
          external_followup_id: item.external_followup_id || `${externalDebtId || debtId}-${item.occurred_at || Date.now()}-${hashPayload(item)}`,
          external_customer_id: externalCustomerId,
          external_debt_id: externalDebtId,
          followup_type: item.followup_type || null,
          followup_channel: item.followup_channel || null,
          original_status: item.original_status || null,
          original_sub_status: item.original_sub_status || null,
          normalized_status: item.normalized_status || null,
          collector_name: item.collector_name || null,
          collector_external_id: item.collector_external_id || null,
          customer_statement: item.customer_statement || null,
          collector_note: item.collector_note || null,
          result_summary: item.result_summary || null,
          next_follow_up_at: item.next_follow_up_at || null,
          occurred_at: item.occurred_at || new Date().toISOString(),
          raw_payload: item.raw_payload || item,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'company_id,source_system,external_followup_id',
        })
      }
    }

    if (payload.status_history?.length) {
      for (const item of payload.status_history) {
        await sb.from('collection_status_history').upsert({
          company_id: companyId,
          customer_id: customerId,
          debt_id: debtId,
          source_system: sourceSystem,
          external_status_id: item.external_status_id || `${externalDebtId || debtId}-${item.changed_at || Date.now()}-${hashPayload(item)}`,
          external_customer_id: externalCustomerId,
          external_debt_id: externalDebtId,
          old_status: item.old_status || null,
          old_sub_status: item.old_sub_status || null,
          new_status: item.new_status || payload.debt?.status || 'unknown',
          new_sub_status: item.new_sub_status || null,
          normalized_status: item.normalized_status || null,
          changed_by_name: item.changed_by_name || null,
          changed_by_external_id: item.changed_by_external_id || null,
          changed_at: item.changed_at || new Date().toISOString(),
          raw_payload: item.raw_payload || item,
        }, {
          onConflict: 'company_id,source_system,external_status_id',
        })
      }
    }

    if (payload.assignments?.length) {
      for (const item of payload.assignments) {
        await sb.from('collection_assignments').upsert({
          company_id: companyId,
          customer_id: customerId,
          debt_id: debtId,
          source_system: sourceSystem,
          external_assignment_id: item.external_assignment_id || `${externalDebtId || debtId}-${item.assigned_at || Date.now()}-${hashPayload(item)}`,
          external_customer_id: externalCustomerId,
          external_debt_id: externalDebtId,
          assigned_to_name: item.assigned_to_name || null,
          assigned_to_external_id: item.assigned_to_external_id || null,
          assigned_by_name: item.assigned_by_name || null,
          assigned_by_external_id: item.assigned_by_external_id || null,
          assignment_status: item.assignment_status || null,
          assigned_at: item.assigned_at || new Date().toISOString(),
          released_at: item.released_at || null,
          raw_payload: item.raw_payload || item,
        }, {
          onConflict: 'company_id,source_system,external_assignment_id',
        })
      }
    }

    if (payload.attachments?.length) {
      for (const item of payload.attachments) {
        await sb.from('collection_attachments').upsert({
          company_id: companyId,
          customer_id: customerId,
          debt_id: debtId,
          source_system: sourceSystem,
          external_attachment_id: item.external_attachment_id || `${externalDebtId || debtId}-${item.file_name || Date.now()}-${hashPayload(item)}`,
          external_customer_id: externalCustomerId,
          external_debt_id: externalDebtId,
          attachment_type: item.attachment_type || null,
          file_name: item.file_name || null,
          file_url: item.file_url || null,
          mime_type: item.mime_type || null,
          uploaded_by_name: item.uploaded_by_name || null,
          uploaded_at: item.uploaded_at || new Date().toISOString(),
          description: item.description || null,
          raw_payload: item.raw_payload || item,
        }, {
          onConflict: 'company_id,source_system,external_attachment_id',
        })
      }
    }

    await sb.from('collection_external_snapshots').upsert({
      company_id: companyId,
      customer_id: customerId,
      debt_id: debtId,
      source_system: sourceSystem,
      external_customer_id: externalCustomerId,
      external_debt_id: externalDebtId,
      external_case_id: externalCaseId || externalDebtId || payload.debt?.reference_number || customerId,
      snapshot_type: 'case_sync',
      payload,
      payload_hash: hashPayload(payload),
      source_updated_at: payload.source_updated_at || new Date().toISOString(),
      synced_at: new Date().toISOString(),
    }, {
      onConflict: 'company_id,source_system,external_case_id,snapshot_type,payload_hash',
    })

    if (payload.remark || payload.event_type) {
      // Both 'collection_sync' AND 'collection_system' were invalid values
      // (timeline_events.event_type/channel only accept a fixed list) —
      // this insert has been failing silently on every sync that reached
      // here since this route shipped. The external system's own
      // payload.event_type is preserved in metadata instead of forced into
      // a column it can never validly satisfy.
      const { error: teErr } = await sb.from('timeline_events').insert({
        company_id: companyId,
        customer_id: customerId,
        debt_id: debtId,
        event_type: 'status_change',
        channel: 'system',
        summary: payload.remark ? payload.remark.slice(0, 120) : 'Collection system sync',
        detail: payload.remark || null,
        actor_type: 'system',
        actor_name: 'Collection System',
        ai_used: false,
        metadata: { external_event_type: payload.event_type ?? null },
        occurred_at: new Date().toISOString(),
      })
      if (teErr) log.error('collection sync timeline insert failed', new Error(teErr.message))
    }

    if (debtId) {
      await processEvent({
        company_id: companyId,
        debt_id: debtId,
        source: 'api_sync',
        event_type: payload.event_type || 'collection_sync',
      } as any)
    }

    return NextResponse.json({
      success: true,
      message: 'Collection sync processed successfully',
      data: {
        company_id: companyId,
        customer_id: customerId,
        debt_id: debtId,
        event_type: payload.event_type || 'collection_sync',
        source_system: sourceSystem,
        synced: {
          followups: payload.followups?.length ?? 0,
          status_history: payload.status_history?.length ?? 0,
          assignments: payload.assignments?.length ?? 0,
          attachments: payload.attachments?.length ?? 0,
          payment: !!payload.payment,
          snapshot: true,
        },
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    )
  }
}


