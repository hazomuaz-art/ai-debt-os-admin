import { NextRequest, NextResponse } from 'next/server'
import { withAuth, parseBody, errors, sendWhatsAppSchema } from '@/lib/api'
import { sendWhatsAppMessage, normalizePhone } from '@/lib/whatsapp'
import { createLogger } from '@/lib/logger'
import { trackMessage, checkWhatsAppLimit } from '@/lib/usage-tracker'

const log = createLogger('api/whatsapp/send')
const RATE_LIMIT_KEY = 'whatsapp_send'
const HOURLY_LIMIT   = 200

export async function POST(request: NextRequest) {
  return withAuth(async (ctx) => {
    const { data: body, error: parseErr } = await parseBody(request, sendWhatsAppSchema)
    if (parseErr) return parseErr

    // Hard usage limit check
    const waLimit = await checkWhatsAppLimit(ctx.profile.company_id)
    if (!waLimit.allowed) {
      return NextResponse.json({ error: waLimit.reason ?? 'WhatsApp limit reached', code: 'RATE_LIMITED' }, { status: 429 })
    }

    try {
      const rateCheck = await ctx.supabase.rpc('check_and_increment_rate_limit', {
        p_key:        RATE_LIMIT_KEY,
        p_company_id: ctx.profile.company_id,
        p_limit_max:  HOURLY_LIMIT,
      })
      if (rateCheck.data === false) return errors.rateLimited()
    } catch {
      // Function not available — skip rate limiting
    }

    // Resolve customer_id from debt if not provided
    let customerId = body.customer_id
    if (!customerId && body.debt_id) {
      const { data: debt } = await ctx.supabase
        .from('debts')
        .select('customer_id')
        .eq('id', body.debt_id)
        .eq('company_id', ctx.profile.company_id)
        .single()

      if (!debt) return errors.notFound('Debt')
      customerId = (debt as { customer_id: string }).customer_id
    }

    // Validate debt belongs to company
    if (body.debt_id) {
      const { data: debtCheck } = await ctx.supabase
        .from('debts')
        .select('id')
        .eq('id', body.debt_id)
        .eq('company_id', ctx.profile.company_id)
        .single()
      if (!debtCheck) return errors.notFound('Debt')
    }

    const phone = normalizePhone(body.phone)
    if (phone.length < 10 || phone.length > 15) {
      return errors.badRequest('Invalid phone number format')
    }

    const result = await sendWhatsAppMessage({ to: phone, message: body.message, company_id: ctx.profile.company_id })

    const { data: savedMessage, error: msgErr } = await ctx.supabase
      .from('messages')
      .insert({
        company_id:          ctx.profile.company_id,
        customer_id:         customerId ?? null,
        debt_id:             body.debt_id ?? null,
        sent_by:             ctx.user.id,
        channel:             'whatsapp',
        direction:           'outbound',
        content:             body.message,
        status:              result.status === 'sent' ? 'sent' : 'failed',
        whatsapp_message_id: result.message_id ?? null,
        sent_at:             new Date().toISOString(),
        metadata:            { phone, error: result.error ?? null },
      })
      .select()
      .single()

    if (msgErr) {
      log.error('Message log insert failed', msgErr)
    }

    if (result.status === 'failed') {
      return NextResponse.json(
        { error: result.error ?? 'WhatsApp send failed', message: savedMessage },
        { status: 422 }
      )
    }

    // Track usage (non-blocking)
    trackMessage({ company_id: ctx.profile.company_id, channel: 'whatsapp', customer_id: customerId ?? undefined }).catch(() => {})

    return NextResponse.json({ data: savedMessage, message_id: result.message_id })
  })
}
