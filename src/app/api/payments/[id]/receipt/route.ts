import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

// GET /api/payments/:id/receipt — redirects to a short-lived signed URL for
// the original receipt file. The 'payment-receipts' bucket is private, so
// every download goes through this auth-checked route rather than a stored
// public link.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAuth(async (ctx) => {
    const { data: payment, error } = await ctx.supabase
      .from('payments')
      .select('id, company_id, receipt_url')
      .eq('id', params.id)
      .eq('company_id', ctx.profile.company_id)
      .maybeSingle()

    if (error || !payment) return errors.notFound('Payment')
    if (!payment.receipt_url) return errors.notFound('Receipt file')

    const { data: signed, error: signErr } = await ctx.serviceClient.storage
      .from('payment-receipts')
      .createSignedUrl(payment.receipt_url, 300)

    if (signErr || !signed?.signedUrl) return errors.internal('Failed to generate download link')

    return NextResponse.redirect(signed.signedUrl)
  }, { requiredRoles: ['admin', 'manager'] })
}
