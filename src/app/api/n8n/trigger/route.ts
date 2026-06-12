import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getN8nClient } from '@/lib/n8n/client'

/**
 * POST /api/n8n/trigger
 * 
 * Secure proxy/trigger route for n8n webhooks.
 * Allows client-side pages to trigger n8n workflows without exposing baseUrl/apiKey.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get user profile to verify company association
  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id) {
    return NextResponse.json({ error: 'Unauthorized: No company profile found' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { webhookPath, event, data } = body

    if (!webhookPath || !event || !data) {
      return NextResponse.json({ error: 'Missing required fields: webhookPath, event, data' }, { status: 400 })
    }

    const n8nClient = getN8nClient()
    const result = await n8nClient.triggerWebhook(webhookPath, {
      event,
      data,
      metadata: {
        company_id: profile.company_id,
        source: 'next-api-trigger',
      }
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to trigger n8n' }, { status: 500 })
    }

    return NextResponse.json({ success: true, data: result.data })
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 })
  }
}
