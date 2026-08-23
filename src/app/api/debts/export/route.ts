import { NextRequest } from 'next/server'
import { errors, withAuth } from '@/lib/api'
import { csvDownloadResponse } from '@/lib/csv'

export const dynamic = 'force-dynamic'

interface DebtExportRow {
  reference_number: string | null
  original_amount: number | null
  current_balance: number | null
  currency: string | null
  status: string | null
  priority: string | null
  due_date: string | null
  product_type: string | null
  account_number: string | null
  notes: string | null
  created_at: string | null
  last_payment_date: string | null
  customer: {
    full_name: string | null
    phone: string | null
    whatsapp: string | null
    national_id: string | null
    city: string | null
    employer: string | null
    monthly_income: number | null
  } | null
  assigned_to_profile: { full_name: string | null; email: string | null } | null
  ai_scores: Array<{
    score: number | null
    risk_classification: string | null
    collection_probability: number | null
    created_at: string | null
  }>
}

const HEADERS = [
  'Reference', 'Customer Name', 'Phone', 'WhatsApp', 'National ID',
  'City', 'Employer', 'Monthly Income', 'Original Amount', 'Current Balance',
  'Currency', 'Status', 'Priority', 'Due Date', 'Product Type', 'Account Number',
  'AI Score', 'Risk Classification', 'Collection Probability %',
  'Assigned To', 'Last Payment Date', 'Created At', 'Notes',
] as const

export async function GET(request: NextRequest) {
  return withAuth(async (ctx) => {
    const { searchParams } = request.nextUrl
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')

    let query = ctx.supabase
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
        ai_scores(score, risk_classification, collection_probability, created_at)
      `)
      .eq('company_id', ctx.profile.company_id)
      .order('created_at', { ascending: false })

    if (status) query = query.eq('status', status)
    if (priority) query = query.eq('priority', priority)

    const { data, error } = await query
    if (error) return errors.internal(error.message)

    const rows = ((data ?? []) as unknown as DebtExportRow[]).map(debt => {
      const latestScore = [...debt.ai_scores].sort((a, b) =>
        new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      )[0]

      return [
        debt.reference_number,
        debt.customer?.full_name,
        debt.customer?.phone,
        debt.customer?.whatsapp,
        debt.customer?.national_id,
        debt.customer?.city,
        debt.customer?.employer,
        debt.customer?.monthly_income,
        debt.original_amount,
        debt.current_balance,
        debt.currency,
        debt.status,
        debt.priority,
        debt.due_date,
        debt.product_type,
        debt.account_number,
        latestScore?.score,
        latestScore?.risk_classification,
        latestScore?.collection_probability == null
          ? null
          : Math.round(latestScore.collection_probability * 100),
        debt.assigned_to_profile?.full_name,
        debt.last_payment_date,
        debt.created_at ? new Date(debt.created_at).toLocaleDateString() : null,
        debt.notes,
      ]
    })

    const date = new Date().toISOString().slice(0, 10)
    return csvDownloadResponse(`debts_export_${date}.csv`, HEADERS, rows)
  }, { requiredRoles: ['admin', 'manager'] })
}
