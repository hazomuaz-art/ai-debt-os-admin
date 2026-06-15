import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { generateOpeningMessage } from '@/lib/opening-message'

// POST { customer_id } → { message }  (generates only, does not send)
export async function POST(request: NextRequest) {
  return withAuth(async (ctx) => {
    let body: { customer_id?: string }
    try {
      body = await request.json()
    } catch {
      return errors.badRequest('Invalid JSON body')
    }
    if (!body.customer_id) return errors.badRequest('customer_id is required')

    // Verify the customer belongs to this company + get latest open debt
    const { data: customer } = await ctx.supabase
      .from('customers')
      .select('id')
      .eq('id', body.customer_id)
      .eq('company_id', ctx.profile.company_id)
      .maybeSingle()
    if (!customer) return errors.notFound('Customer')

    const { data: debt } = await ctx.supabase
      .from('debts')
      .select('id')
      .eq('company_id', ctx.profile.company_id)
      .eq('customer_id', body.customer_id)
      .not('status', 'in', '("settled","written_off")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const message = await generateOpeningMessage({
      company_id: ctx.profile.company_id,
      customer_id: body.customer_id,
      debt_id: (debt as { id: string } | null)?.id ?? null,
    })

    return NextResponse.json({ message })
  })
}
