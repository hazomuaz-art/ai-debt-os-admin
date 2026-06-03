import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { processEvent } from '@/lib/automation-pipeline'

type IncomingPayload = {
  event_type?: string
  company_id?: string
  customer?: {
    full_name?: string
    phone?: string
    whatsapp?: string
    national_id?: string
    city?: string
    employer?: string
    monthly_income?: number
    notes?: string
  }
  debt?: {
    reference_number?: string
    account_number?: string
    original_amount?: number
    current_balance?: number
    currency?: string
    status?: string
    priority?: string
    due_date?: string
    product_type?: string
    creditor_name?: string
    notes?: string
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
}

function cleanPhone(v?: string) {
  return String(v ?? '').replace(/\D/g, '')
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as IncomingPayload
    const sb = createServiceClient()

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

    if (!payload.customer?.full_name && !payload.customer?.phone && !payload.customer?.whatsapp && !payload.customer?.national_id) {
      return NextResponse.json(
        { success: false, error: 'customer full_name, phone, whatsapp, or national_id required' },
        { status: 400 }
      )
    }

    const phone = cleanPhone(payload.customer?.phone)
    const whatsapp = cleanPhone(payload.customer?.whatsapp)

    let customerId: string | null = null

    if (payload.customer?.national_id) {
      const { data } = await sb.from('customers')
        .select('id')
        .eq('company_id', companyId)
        .eq('national_id', payload.customer.national_id)
        .maybeSingle()
      customerId = data?.id ?? null
    }

    if (!customerId && phone) {
      const { data } = await sb.from('customers')
        .select('id')
        .eq('company_id', companyId)
        .ilike('phone', `%${phone}%`)
        .maybeSingle()
      customerId = data?.id ?? null
    }

    if (!customerId && whatsapp) {
      const { data } = await sb.from('customers')
        .select('id')
        .eq('company_id', companyId)
        .ilike('whatsapp', `%${whatsapp}%`)
        .maybeSingle()
      customerId = data?.id ?? null
    }

    if (!customerId) {
      const { data, error } = await sb.from('customers')
        .insert({
          company_id: companyId,
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
          metadata: { source: 'collection_sync' },
        })
        .select('id')
        .single()

      if (error) throw error
      customerId = data.id
    } else {
      await sb.from('customers')
        .update({
          full_name: payload.customer?.full_name || undefined,
          phone: phone || undefined,
          whatsapp: whatsapp || undefined,
          city: payload.customer?.city || undefined,
          employer: payload.customer?.employer || undefined,
          monthly_income: payload.customer?.monthly_income ?? undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', customerId)
        .eq('company_id', companyId)
    }

    let debtId: string | null = null

    if (payload.debt?.reference_number) {
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
          reference_number: payload.debt.reference_number || `SYNC-${Date.now()}`,
          account_number: payload.debt.account_number || null,
          original_amount: payload.debt.original_amount ?? payload.debt.current_balance ?? 0,
          current_balance: payload.debt.current_balance ?? payload.debt.original_amount ?? 0,
          currency: payload.debt.currency || 'SAR',
          status: payload.debt.status || 'active',
          priority: payload.debt.priority || 'medium',
          due_date: payload.debt.due_date || null,
          product_type: payload.debt.product_type || null,
          creditor_name: payload.debt.creditor_name || null,
          notes: payload.debt.notes || null,
          interest_rate: 0,
          penalty_amount: 0,
          metadata: { source: 'collection_sync' },
        })
        .select('id')
        .single()

      if (error) throw error
      debtId = data.id
    } else if (payload.debt && debtId) {
      await sb.from('debts')
        .update({
          current_balance: payload.debt.current_balance ?? undefined,
          status: payload.debt.status || undefined,
          priority: payload.debt.priority || undefined,
          due_date: payload.debt.due_date || undefined,
          creditor_name: payload.debt.creditor_name || undefined,
          product_type: payload.debt.product_type || undefined,
          notes: payload.debt.notes || undefined,
          updated_at: new Date().toISOString(),
        })
        .eq('id', debtId)
        .eq('company_id', companyId)
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

    if (payload.remark || payload.event_type) {
      await sb.from('timeline_events').insert({
        company_id: companyId,
        customer_id: customerId,
        debt_id: debtId,
        event_type: payload.event_type || 'collection_sync',
        channel: 'collection_system',
        summary: payload.remark ? payload.remark.slice(0, 120) : 'Collection system sync',
        detail: payload.remark || null,
        actor_type: 'system',
        actor_name: 'Collection System',
        ai_used: false,
        occurred_at: new Date().toISOString(),
      })
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
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
