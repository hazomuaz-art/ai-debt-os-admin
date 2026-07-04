import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * GET /api/portfolio-whatsapp-numbers/connect?id=xxx
 * Returns connection state of the WAHA session bound to this number.
 *
 * POST /api/portfolio-whatsapp-numbers/connect
 * Body: { id: string }
 * Starts the session (if needed) and returns the pairing QR code.
 *
 * DELETE /api/portfolio-whatsapp-numbers/connect?id=xxx
 * Logs out / stops the session.
 *
 * The `instance_name` column is reused as the WAHA session name.
 */

type WahaCfg = { apiUrl: string; apiKey: string }

async function resolveWaha(company_id: string, numberApiUrl?: string | null): Promise<WahaCfg | null> {
  const supabase = createServiceClient()
  const { data: integration } = await supabase
    .from('integration_settings')
    .select('config')
    .eq('company_id', company_id)
    .eq('integration_name', 'waha')
    .maybeSingle()

  const cfg = (integration?.config as Record<string, string> | undefined) ?? {}
  const apiUrl = (numberApiUrl || cfg.api_url || process.env.WAHA_API_URL || '').replace(/\/$/, '')
  const apiKey = cfg.api_key || process.env.WAHA_API_KEY || ''
  if (!apiUrl || !apiKey) return null
  return { apiUrl, apiKey }
}

function wahaHeaders(apiKey: string) {
  return { 'Content-Type': 'application/json', 'X-Api-Key': apiKey }
}

export async function GET(req: NextRequest) {
  return withAuth(async (ctx) => {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return errors.badRequest('Missing id parameter')

    const { data: number, error } = await ctx.supabase
      .from('portfolio_whatsapp_numbers')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.profile.company_id)
      .single()

    if (error || !number) return errors.notFound('WhatsApp number not found')

    const waha = await resolveWaha(ctx.profile.company_id, number.api_url)
    if (!waha) {
      return NextResponse.json({ success: false, state: 'close', error: 'WAHA credentials not configured' })
    }

    try {
      const r = await fetch(`${waha.apiUrl}/api/sessions/${number.instance_name}`, {
        headers: wahaHeaders(waha.apiKey),
        cache: 'no-store',
      })
      const j = await r.json().catch(() => ({} as any))
      const state = j?.status === 'WORKING' ? 'open' : String(j?.status ?? 'close').toLowerCase()
      return NextResponse.json({ success: true, state, status: j?.status ?? 'unknown' })
    } catch (err) {
      return NextResponse.json({
        success: false,
        state: 'close',
        error: err instanceof Error ? err.message : 'Failed to fetch status',
      })
    }
  })
}

export async function POST(req: NextRequest) {
  return withAuth(async (ctx) => {
    let body: any
    try { body = await req.json() } catch { return errors.badRequest('Invalid JSON') }

    const { id } = body
    if (!id) return errors.badRequest('Missing id parameter')

    const { data: number, error } = await ctx.supabase
      .from('portfolio_whatsapp_numbers')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.profile.company_id)
      .single()

    if (error || !number) return errors.notFound('WhatsApp number not found')

    const waha = await resolveWaha(ctx.profile.company_id, number.api_url)
    if (!waha) return errors.badRequest('WAHA credentials not configured')

    const session = number.instance_name as string

    try {
      // Ensure the session exists/started before requesting its QR. WAHA
      // returns 422 if it already exists or is running — that's fine.
      await fetch(`${waha.apiUrl}/api/sessions/${session}/start`, {
        method: 'POST',
        headers: wahaHeaders(waha.apiKey),
      }).catch(() => {})

      const r = await fetch(`${waha.apiUrl}/api/${session}/auth/qr?format=image`, {
        headers: { 'X-Api-Key': waha.apiKey },
        cache: 'no-store',
      })
      if (!r.ok) {
        return NextResponse.json(
          { success: false, error: `WAHA QR returned HTTP ${r.status}` },
          { status: 502 }
        )
      }
      const b64 = Buffer.from(await r.arrayBuffer()).toString('base64')
      return NextResponse.json({ success: true, base64: `data:image/png;base64,${b64}` })
    } catch (err) {
      return NextResponse.json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to retrieve QR code',
      }, { status: 502 })
    }
  })
}

export async function DELETE(req: NextRequest) {
  return withAuth(async (ctx) => {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return errors.badRequest('Missing id parameter')

    const { data: number, error } = await ctx.supabase
      .from('portfolio_whatsapp_numbers')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.profile.company_id)
      .single()

    if (error || !number) return errors.notFound('WhatsApp number not found')

    const waha = await resolveWaha(ctx.profile.company_id, number.api_url)
    if (!waha) return errors.badRequest('WAHA credentials not configured')

    // Real incident (2026-07-04): a portfolio number's instance_name was set
    // to "default" - the SAME WAHA session name the company's primary,
    // company-wide WhatsApp integration uses (integration_settings.config.
    // session). Disconnecting this "portfolio" number from this UI silently
    // logged out the shared primary session, taking down WhatsApp for the
    // entire company for two days before anyone noticed. This is not a
    // one-off data-entry mistake to just correct once - the UI itself must
    // refuse to disconnect a session name that is currently the company's
    // primary shared session, since any future number reusing that name
    // would reproduce the exact same outage.
    const { data: primaryIntegration } = await ctx.supabase
      .from('integration_settings')
      .select('config')
      .eq('company_id', ctx.profile.company_id)
      .eq('integration_name', 'waha')
      .maybeSingle()
    const primarySession = (primaryIntegration?.config as Record<string, string> | undefined)?.session
    if (primarySession && number.instance_name === primarySession) {
      return errors.badRequest(
        `لا يمكن فصل هذا الرقم من هنا - جلسته ("${number.instance_name}") هي نفس جلسة الواتساب الرئيسية المشتركة لكامل الشركة. فصلها من هذه الصفحة يقطع الواتساب عن كل النظام، ليس فقط عن هذه المحفظة.`
      )
    }

    try {
      await fetch(`${waha.apiUrl}/api/sessions/${number.instance_name}/logout`, {
        method: 'POST',
        headers: wahaHeaders(waha.apiKey),
      })
      return NextResponse.json({ success: true, message: 'Session disconnected successfully' })
    } catch (err) {
      return NextResponse.json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to disconnect session',
      }, { status: 502 })
    }
  })
}
