import { createLogger } from '@/lib/logger'
const logger = createLogger('api/payments/export')

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
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    let query = supabase
      .from('payments')
      .select(`
        amount, currency, payment_date, status, verification_status, payment_method,
        reference_number, notes, created_at,
        customer:customers(full_name, phone, whatsapp),
        debt:debts(reference_number)
      `)
      .eq('company_id', profile.company_id)
      .order('payment_date', { ascending: false })

    if (from) query = query.gte('payment_date', from)
    if (to) query = query.lte('payment_date', to)

    const { data: payments, error } = await query
    if (error) throw error

    const headers = [
      'اسم العميل', 'الهاتف', 'رقم الدين المرجعي', 'المبلغ', 'العملة',
      'تاريخ السداد', 'طريقة الدفع', 'حالة الدفعة', 'حالة التحقق', 'المرجع', 'ملاحظات',
    ]

    const rows = (payments ?? []).map((p: any) => [
      p.customer?.full_name,
      p.customer?.whatsapp || p.customer?.phone,
      p.debt?.reference_number,
      p.amount,
      p.currency,
      p.payment_date,
      p.payment_method,
      p.status,
      p.verification_status,
      p.reference_number,
      p.notes,
    ].map(escapeCSV))

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="payments_export_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  } catch (error) {
    logger.error('Export failed', error)
    return new NextResponse('Export failed', { status: 500 })
  }
}
