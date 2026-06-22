import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

export async function GET(req: NextRequest) {
  return withAuth(async (ctx) => {
    const status = req.nextUrl.searchParams.get('status')
    let q = ctx.supabase
      .from('legal_escalations')
      .select(`
        id, escalation_type, reason, status, opened_at, closed_at, admin_notes,
        customer:customers(id, full_name, phone),
        debt:debts(id, reference_number, current_balance, currency, portfolio:portfolios(id, name, name_ar)),
        closed_by_profile:profiles!legal_escalations_closed_by_fkey(id, full_name)
      `)
      .eq('company_id', ctx.profile.company_id)
      .order('opened_at', { ascending: false })
    if (status) q = q.eq('status', status)

    const { data, error } = await q
    if (error) return errors.internal(error.message)
    return NextResponse.json({ data: data ?? [] })
  })
}
