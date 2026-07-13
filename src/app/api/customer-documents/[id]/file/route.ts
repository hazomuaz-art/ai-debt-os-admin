import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'

// GET /api/customer-documents/:id/file — same pattern as
// /api/payments/:id/receipt: the 'customer-documents' storage bucket is
// private, so every view goes through this auth-checked route instead of a
// stored public link. Collector role included (unlike the receipt route)
// since collectors are the ones actually working these files day-to-day on
// the debt detail page.
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return withAuth(async (ctx) => {
    const { data: doc, error } = await ctx.supabase
      .from('customer_documents')
      .select('id, company_id, storage_path')
      .eq('id', params.id)
      .eq('company_id', ctx.profile.company_id)
      .maybeSingle()

    if (error || !doc) return errors.notFound('Document')
    if (!doc.storage_path) return errors.notFound('Document file')

    const { data: signed, error: signErr } = await ctx.serviceClient.storage
      .from('customer-documents')
      .createSignedUrl(doc.storage_path, 300)

    if (signErr || !signed?.signedUrl) return errors.internal('Failed to generate download link')

    return NextResponse.redirect(signed.signedUrl)
  }, { requiredRoles: ['admin', 'manager', 'collector'] })
}
