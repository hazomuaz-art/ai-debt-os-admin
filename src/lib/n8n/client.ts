// AI Debt OS — n8n Integration Client
// Communicates with n8n workflows via HTTP webhooks

type N8nWebhookPayload = {
  event: string
  data: Record<string, unknown>
  metadata?: {
    company_id?: string
    customer_id?: string
    debt_id?: string
    source?: string
    timestamp?: string
  }
}

type N8nResponse = {
  success: boolean
  workflow_id?: string
  execution_id?: string
  data?: Record<string, unknown>
  error?: string
}

class N8nClient {
  private baseUrl: string
  private apiKey: string

  constructor() {
    this.baseUrl = process.env.N8N_BASE_URL || ''
    this.apiKey = process.env.N8N_API_KEY || ''
  }

  private get headers() {
    return {
      'Content-Type': 'application/json',
      ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
    }
  }

  /**
   * Trigger an n8n workflow via webhook
   */
  async triggerWebhook(webhookPath: string, payload: N8nWebhookPayload): Promise<N8nResponse> {
    let url = this.baseUrl
    let key = this.apiKey
    let authHeader = ''

    // If company_id is provided, try to fetch custom n8n config from DB
    if (payload.metadata?.company_id) {
      const { createServiceClient } = await import('@/lib/supabase/server')
      const supabase = createServiceClient()
      const { data: settings } = await supabase
        .from('integration_settings')
        .select('config')
        .eq('company_id', payload.metadata.company_id)
        .eq('integration_name', 'n8n_automation')
        .eq('enabled', true)
        .maybeSingle()

      if (settings?.config) {
        const config = settings.config as Record<string, string>
        // webhook_url might be the full URL (e.g. https://n8n.domain.com/webhook/path) or just base
        // But in our UI we asked for 'webhook_url' so they might put full webhook base.
        if (config.webhook_url) {
          url = config.webhook_url.replace(/\/webhook\/.*$/, '').replace(/\/$/, '')
        }
        if (config.auth_token) {
          key = config.auth_token
        }
      }
    }

    if (!url) {
      console.warn('[n8n] N8N_BASE_URL not configured and no company config found, skipping webhook trigger')
      return { success: false, error: 'n8n not configured' }
    }

    const fullUrl = `${url}/webhook/${webhookPath}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (key) {
      // If it's a JWT key or standard Bearer
      headers['Authorization'] = `Bearer ${key}`
      headers['X-N8N-API-KEY'] = key // Fallback for n8n standard API
    }

    try {
      const response = await fetch(fullUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...payload,
          metadata: {
            ...payload.metadata,
            timestamp: payload.metadata?.timestamp || new Date().toISOString(),
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[n8n] Webhook ${webhookPath} failed: ${response.status} — ${errorText}`)
        return { success: false, error: `HTTP ${response.status}: ${errorText}` }
      }

      const data = await response.json().catch(() => ({}))
      return { success: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[n8n] Webhook ${webhookPath} error: ${message}`)
      return { success: false, error: message }
    }
  }

  // ── WhatsApp Workflows ──

  /**
   * Send a WhatsApp message via n8n → WAHA gateway
   */
  async sendWhatsAppMessage(params: {
    company_id: string
    customer_id: string
    phone_number: string
    message: string
    instance_name: string
    message_type?: 'text' | 'template' | 'image' | 'document'
    template_name?: string
    template_params?: string[]
  }): Promise<N8nResponse> {
    return this.triggerWebhook('whatsapp-outbound', {
      event: 'send_message',
      data: {
        ...params,
        api_url: process.env.WAHA_API_URL || '',
        api_key: process.env.WAHA_API_KEY || '',
        session: process.env.WAHA_SESSION || 'default',
      },
      metadata: {
        company_id: params.company_id,
        customer_id: params.customer_id,
        source: 'next-app',
      },
    })
  }

  // ── AI Workflows ──

  /**
   * Trigger AI analysis for a customer message
   */
  async triggerAIAnalysis(params: {
    company_id: string
    customer_id: string
    debt_id?: string
    message: string
    context?: string
    conversation_id?: string
    instance_name?: string
  }): Promise<N8nResponse> {
    return this.triggerWebhook('ai-analyze', {
      event: 'incoming_message',
      data: params,
      metadata: {
        company_id: params.company_id,
        customer_id: params.customer_id,
        debt_id: params.debt_id,
        source: 'whatsapp',
      },
    })
  }

  // ── Sync Workflows ──

  /**
   * Trigger collection system sync
   */
  async triggerSync(params: {
    company_id: string
    sync_type: 'full' | 'incremental' | 'customers' | 'debts' | 'payments'
    source_system?: string
  }): Promise<N8nResponse> {
    return this.triggerWebhook('collection-sync', {
      event: 'sync_trigger',
      data: params,
      metadata: {
        company_id: params.company_id,
        source: 'manual',
      },
    })
  }

  // ── Campaign Workflows ──

  /**
   * Execute a campaign via n8n
   */
  async executeCampaign(params: {
    company_id: string
    campaign_id: string
    action: 'start' | 'pause' | 'resume' | 'cancel'
  }): Promise<N8nResponse> {
    return this.triggerWebhook('campaign-executor', {
      event: `campaign_${params.action}`,
      data: params,
      metadata: {
        company_id: params.company_id,
        source: 'next-app',
      },
    })
  }

  // ── Promise Follow-up ──

  /**
   * Trigger promise follow-up (usually on schedule, but can be manual)
   */
  async triggerPromiseFollowUp(params: {
    company_id: string
    promise_id?: string
  }): Promise<N8nResponse> {
    return this.triggerWebhook('promise-follow-up', {
      event: 'follow_up_trigger',
      data: params,
      metadata: {
        company_id: params.company_id,
        source: params.promise_id ? 'manual' : 'schedule',
      },
    })
  }
}

// Singleton instance
let _n8nClient: N8nClient | null = null

export function getN8nClient(): N8nClient {
  if (!_n8nClient) {
    _n8nClient = new N8nClient()
  }
  return _n8nClient
}

export type { N8nWebhookPayload, N8nResponse }
