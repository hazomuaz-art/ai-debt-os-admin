import { NextRequest } from 'next/server'
import { errors, withAuth } from '@/lib/api'
import { csvDownloadResponse } from '@/lib/csv'

export const dynamic = 'force-dynamic'

interface PaymentExportRow {
  amount: number | null
  currency: string | null
  payment_date: string | null
  status: string | null
  verification_status: string | null
  payment_method: string | null
  reference_number: string | null
  notes: string | null
  customer: { full_name: string | null; phone: string | null; whatsapp: string | null } | null
  debt: { reference_number: string | null } | null
}

const HEADERS = [
  'اسم العميل', 'الهاتف', 'رقم الدين المرجعي', 'المبلغ', 'العملة',
  'تاريخ السداد', 'طريقة الدفع', 'حالة الدفعة', 'حالة التحقق', 'المرجع', 'ملاحظات',
] as const

export async function GET(request: NextRequest) {
  return withAuth(async (ctx) => {
    const from = request.nextUrl.searchParams.get('from')
    const to = request.nextUrl.searchParams.get('to')

    let query = ctx.supabase
      .from('payments')
      .select(`
        amount, currency, payment_date, status, verification_status, payment_method,
        reference_number, notes,
        customer:customers(full_name, phone, whatsapp),
        debt:debts(reference_number)
      `)
      .eq('company_id', ctx.profile.company_id)
      .order('payment_date', { ascending: false })

    if (from) query = query.gte('payment_date', from)
    if (to) query = query.lte('payment_date', to)

    const { data, error } = await query
    if (error) return errors.internal(error.message)

    const rows = ((data ?? []) as unknown as PaymentExportRow[]).map(payment => [
      payment.customer?.full_name,
      payment.customer?.whatsapp || payment.customer?.phone,
      payment.debt?.reference_number,
      payment.amount,
      payment.currency,
      payment.payment_date,
      payment.payment_method,
      payment.status,
      payment.verification_status,
      payment.reference_number,
      payment.notes,
    ])

    const date = new Date().toISOString().slice(0, 10)
    return csvDownloadResponse(`payments_export_${date}.csv`, HEADERS, rows)
  }, { requiredRoles: ['admin', 'manager'] })
}
