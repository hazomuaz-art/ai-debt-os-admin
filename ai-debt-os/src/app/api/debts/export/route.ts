import { createLogger } from '@/lib/logger'
const logger = createLogger('api/debts/export')

import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
import { createClient } from '@/lib/supabase/server'

function escapeCSV(val: any): string {
  if (val == null) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new NextResponse('Unauthorized', { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('company_id, role')
      .eq('id', user.id)
      .single()

    if (!profile?.company_id) return new NextResponse('No company', { status: 400 })
    if (!['admin', 'manager'].includes(profile.role)) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')

    let query = supabase
      .from('debts')
      .select(`
        reference_number,
        original_amount,
        current_balance,
        currency,
        status,
        priority,
        due_date,
        product_type,
        account_number,
        notes,
        created_at,
        last_payment_date,
        customer:customers(full_name, phone, whatsapp, national_id, city, employer, monthly_income),
        assigned_to_profile:profiles!debts_assigned_to_fkey(full_name, email),
        ai_scores(score, risk_classification, collection_probability)
      `)
      .eq('company_id', profile.company_id)
      .order('created_at', { ascending: false })

    if (status) query = (query as any).eq('status', status)
    if (priority) query = (query as any).eq('priority', priority)

    const { data: debts, error } = await query
    if (error) return new NextResponse(error.message, { status: 500 })

    const headers = [
      'Reference', 'Customer Name', 'Phone', 'WhatsApp', 'National ID',
      'City', 'Employer', 'Monthly Income', 'Original Amount', 'Current Balance',
      'Currency', 'Status', 'Priority', 'Due Date', 'Product Type', 'Account Number',
      'AI Score', 'Risk Classification', 'Collection Probability %',
      'Assigned To', 'Last Payment Date', 'Created At', 'Notes',
    ]

    const rows = (debts ?? []).map((d: any) => {
      const latestScore = d.ai_scores?.sort((a: any, b: any) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      )[0]

      return [
        d.reference_number,
        d.customer?.full_name,
        d.customer?.phone,
        d.customer?.whatsapp,
        d.customer?.national_id,
        d.customer?.city,
        d.customer?.employer,
        d.customer?.monthly_income,
        d.original_amount,
        d.current_balance,
        d.currency,
        d.status,
        d.priority,
        d.due_date,
        d.product_type,
        d.account_number,
        latestScore?.score ?? '',
        latestScore?.risk_classification ?? '',
        latestScore ? Math.round(latestScore.collection_probability * 100) : '',
        d.assigned_to_profile?.full_name ?? '',
        d.last_payment_date ?? '',
        d.created_at ? new Date(d.created_at).toLocaleDateString() : '',
        d.notes,
      ].map(escapeCSV)
    })

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="debts_export_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  } catch (error) {
    logger.error('Export failed', error)
    return new NextResponse('Export failed', { status: 500 })
  }
}
