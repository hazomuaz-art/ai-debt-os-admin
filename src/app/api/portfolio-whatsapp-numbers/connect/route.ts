import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { getEvolutionManager } from '@/lib/evolution/client'

/**
 * GET /api/portfolio-whatsapp-numbers/connect?id=xxx
 * Returns connection state of the WhatsApp instance.
 * 
 * POST /api/portfolio-whatsapp-numbers/connect
 * Body: { id: string }
 * Returns connection QR code.
 * 
 * DELETE /api/portfolio-whatsapp-numbers/connect?id=xxx
 * Disconnects/logs out the instance.
 */

export async function GET(req: NextRequest) {
  return withAuth(async (ctx) => {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return errors.badRequest('Missing id parameter')

    // Fetch the whatsapp number config
    const { data: number, error } = await ctx.supabase
      .from('portfolio_whatsapp_numbers')
      .select('*')
      .eq('id', id)
      .eq('company_id', ctx.profile.company_id)
      .single()

    if (error || !number) return errors.notFound('WhatsApp number not found')

    // Fetch the integration settings for Evolution
    const { data: integration } = await ctx.supabase
      .from('integration_settings')
      .select('config')
      .eq('company_id', ctx.profile.company_id)
      .eq('integration_name', 'evolution_whatsapp')
      .maybeSingle()

    const apiKey = (integration?.config as Record<string, string>)?.api_key || ''
    const apiUrl = number.api_url || (integration?.config as Record<string, string>)?.api_url || ''

    if (!apiUrl || !apiKey) {
      return NextResponse.json({ success: false, state: 'close', error: 'Evolution API credentials not configured' })
    }

    try {
      const manager = getEvolutionManager()
      const client = manager.getOrCreate(number.instance_name, apiUrl, apiKey)
      const status = await client.getStatus()
      return NextResponse.json({ success: true, ...status })
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

    const { data: integration } = await ctx.supabase
      .from('integration_settings')
      .select('config')
      .eq('company_id', ctx.profile.company_id)
      .eq('integration_name', 'evolution_whatsapp')
      .maybeSingle()

    const apiKey = (integration?.config as Record<string, string>)?.api_key || ''
    const apiUrl = number.api_url || (integration?.config as Record<string, string>)?.api_url || ''

    if (!apiUrl || !apiKey) {
      return errors.badRequest('Evolution API credentials not configured')
    }

    try {
      const manager = getEvolutionManager()
      const client = manager.getOrCreate(number.instance_name, apiUrl, apiKey)
      const qrData = await client.getQRCode()
      return NextResponse.json({ success: true, ...qrData })
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

    const { data: integration } = await ctx.supabase
      .from('integration_settings')
      .select('config')
      .eq('company_id', ctx.profile.company_id)
      .eq('integration_name', 'evolution_whatsapp')
      .maybeSingle()

    const apiKey = (integration?.config as Record<string, string>)?.api_key || ''
    const apiUrl = number.api_url || (integration?.config as Record<string, string>)?.api_url || ''

    if (!apiUrl || !apiKey) {
      return errors.badRequest('Evolution API credentials not configured')
    }

    try {
      const manager = getEvolutionManager()
      const client = manager.getOrCreate(number.instance_name, apiUrl, apiKey)
      await client.disconnect()
      return NextResponse.json({ success: true, message: 'Instance disconnected successfully' })
    } catch (err) {
      return NextResponse.json({
        success: false,
        error: err instanceof Error ? err.message : 'Failed to disconnect instance',
      }, { status: 502 })
    }
  })
}
