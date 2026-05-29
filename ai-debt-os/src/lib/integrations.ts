/**
 * Integration adapters for third-party services.
 *
 * Each adapter exposes the same interface:
 *   testConnection(config) → { success, message, latency_ms? }
 *   Plus service-specific methods (ready for real implementation).
 *
 * All methods are safe to call before credentials are configured —
 * they return descriptive errors rather than throwing.
 */

import { createLogger } from '@/lib/logger'

const log = createLogger('integrations')

// ── Shared helpers ────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url:        string,
  options:    RequestInit,
  timeoutMs = 8000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export interface TestResult {
  success:     boolean
  message:     string
  latency_ms?: number
}

// ── Rasf WhatsApp ─────────────────────────────────────────────────────────

export const rasfWhatsApp = {
  /**
   * Test connectivity to the Rasf WhatsApp gateway.
   * Performs a lightweight GET to /status or /ping endpoint.
   */
  async testConnection(config: Record<string, string>): Promise<TestResult> {
    const { api_url, token } = config

    if (!api_url || !token) {
      return { success: false, message: 'API URL and Token are required' }
    }

    const start = Date.now()
    try {
      const res = await fetchWithTimeout(
        `${api_url.replace(/\/$/, '')}/status`,
        {
          method:  'GET',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        },
      )

      const latency_ms = Date.now() - start

      if (res.ok) {
        log.info('Rasf WhatsApp test OK', { status: res.status, latency_ms })
        return { success: true, message: `Connected (${res.status}) in ${latency_ms}ms`, latency_ms }
      }

      return { success: false, message: `HTTP ${res.status}: ${res.statusText}`, latency_ms }
    } catch (err) {
      const latency_ms = Date.now() - start
      const msg = err instanceof Error
        ? (err.name === 'AbortError' ? 'Connection timed out (8s)' : err.message)
        : 'Connection failed'
      return { success: false, message: msg, latency_ms }
    }
  },

  /**
   * Send a WhatsApp message via the Rasf gateway.
   * Returns the gateway's message ID on success.
   */
  async sendWhatsAppMessage(
    config:  Record<string, string>,
    to:      string,
    message: string,
  ): Promise<{ success: boolean; message_id?: string; error?: string }> {
    const { api_url, token, sender_id } = config

    if (!api_url || !token) {
      return { success: false, error: 'Rasf WhatsApp not configured' }
    }

    log.info('Rasf: sending WhatsApp message', { to, sender_id })

    try {
      const res = await fetchWithTimeout(
        `${api_url.replace(/\/$/, '')}/messages/send`,
        {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body:    JSON.stringify({ to, message, sender_id }),
        },
      )

      const data = await res.json() as { id?: string; message_id?: string; error?: string }

      if (res.ok) {
        return { success: true, message_id: data.id ?? data.message_id }
      }
      return { success: false, error: data.error ?? `HTTP ${res.status}` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Send failed' }
    }
  },

  /**
   * Parse an inbound webhook payload from the Rasf gateway.
   * Returns normalised message fields regardless of payload version.
   */
  receiveWebhook(payload: Record<string, unknown>): {
    from:      string
    message:   string
    timestamp: string
    raw:       Record<string, unknown>
  } | null {
    // Rasf sends { from, body, timestamp } or { sender, text, sent_at }
    const from      = String(payload.from ?? payload.sender ?? '')
    const message   = String(payload.body ?? payload.text ?? payload.message ?? '')
    const timestamp = String(payload.timestamp ?? payload.sent_at ?? new Date().toISOString())

    if (!from || !message) {
      log.warn('Rasf: unrecognised webhook payload', { payload })
      return null
    }

    return { from, message, timestamp, raw: payload }
  },
}

// ── Tameez Calls ─────────────────────────────────────────────────────────

export const tameezCalls = {
  /**
   * Test connectivity to Tameez Calls API.
   */
  async testConnection(config: Record<string, string>): Promise<TestResult> {
    const { api_url, api_key } = config

    if (!api_url || !api_key) {
      return { success: false, message: 'API URL and API Key are required' }
    }

    const start = Date.now()
    try {
      const res = await fetchWithTimeout(
        `${api_url.replace(/\/$/, '')}/ping`,
        {
          method:  'GET',
          headers: { 'X-API-Key': api_key, 'Content-Type': 'application/json' },
        },
      )

      const latency_ms = Date.now() - start

      if (res.ok) {
        log.info('Tameez Calls test OK', { status: res.status, latency_ms })
        return { success: true, message: `Connected (${res.status}) in ${latency_ms}ms`, latency_ms }
      }

      return { success: false, message: `HTTP ${res.status}: ${res.statusText}`, latency_ms }
    } catch (err) {
      const latency_ms = Date.now() - start
      const msg = err instanceof Error
        ? (err.name === 'AbortError' ? 'Connection timed out (8s)' : err.message)
        : 'Connection failed'
      return { success: false, message: msg, latency_ms }
    }
  },

  /**
   * Sync call records from Tameez into a normalised array.
   * Returns raw call objects; caller maps to domain model.
   */
  async syncCalls(
    config: Record<string, string>,
    since?: string,
  ): Promise<{ success: boolean; calls: unknown[]; error?: string }> {
    const { api_url, api_key } = config

    if (!api_url || !api_key) {
      return { success: false, calls: [], error: 'Tameez Calls not configured' }
    }

    log.info('Tameez: syncing calls', { since })

    try {
      const url = new URL(`${api_url.replace(/\/$/, '')}/calls`)
      if (since) url.searchParams.set('since', since)

      const res = await fetchWithTimeout(url.toString(), {
        method:  'GET',
        headers: { 'X-API-Key': api_key, 'Content-Type': 'application/json' },
      })

      const data = await res.json() as { calls?: unknown[]; data?: unknown[]; error?: string }

      if (res.ok) {
        const calls = data.calls ?? data.data ?? []
        log.info('Tameez: synced calls', { count: (calls as unknown[]).length })
        return { success: true, calls: calls as unknown[] }
      }

      return { success: false, calls: [], error: data.error ?? `HTTP ${res.status}` }
    } catch (err) {
      return { success: false, calls: [], error: err instanceof Error ? err.message : 'Sync failed' }
    }
  },

  /**
   * Request AI analysis of a call recording from Tameez.
   * Returns sentiment, topics, and recommended follow-up action.
   */
  async analyzeCall(
    config: Record<string, string>,
    callId: string,
  ): Promise<{
    success:    boolean
    sentiment?: 'positive' | 'neutral' | 'negative'
    topics?:    string[]
    summary?:   string
    action?:    string
    error?:     string
  }> {
    const { api_url, api_key } = config

    if (!api_url || !api_key) {
      return { success: false, error: 'Tameez Calls not configured' }
    }

    log.info('Tameez: analyzing call', { callId })

    try {
      const res = await fetchWithTimeout(
        `${api_url.replace(/\/$/, '')}/calls/${callId}/analyze`,
        {
          method:  'POST',
          headers: { 'X-API-Key': api_key, 'Content-Type': 'application/json' },
        },
        15000, // analysis can take longer
      )

      const data = await res.json() as {
        sentiment?: 'positive' | 'neutral' | 'negative'
        topics?:    string[]
        summary?:   string
        action?:    string
        error?:     string
      }

      if (res.ok) {
        return { success: true, ...data }
      }
      return { success: false, error: data.error ?? `HTTP ${res.status}` }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Analysis failed' }
    }
  },
}

// ── Collection System API ─────────────────────────────────────────────────

export const collectionApi = {
  /**
   * Test connectivity to the external Collection System.
   */
  async testConnection(config: Record<string, string>): Promise<TestResult> {
    const { base_url, username, token } = config

    if (!base_url || (!username && !token)) {
      return { success: false, message: 'Base URL and credentials are required' }
    }

    const start = Date.now()
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token)    headers['Authorization'] = `Bearer ${token}`
      if (username) headers['X-Username'] = username

      const res = await fetchWithTimeout(
        `${base_url.replace(/\/$/, '')}/health`,
        { method: 'GET', headers },
      )

      const latency_ms = Date.now() - start

      if (res.ok) {
        log.info('Collection API test OK', { status: res.status, latency_ms })
        return { success: true, message: `Connected (${res.status}) in ${latency_ms}ms`, latency_ms }
      }

      return { success: false, message: `HTTP ${res.status}: ${res.statusText}`, latency_ms }
    } catch (err) {
      const latency_ms = Date.now() - start
      const msg = err instanceof Error
        ? (err.name === 'AbortError' ? 'Connection timed out (8s)' : err.message)
        : 'Connection failed'
      return { success: false, message: msg, latency_ms }
    }
  },

  /**
   * Pull all debt records from the external system.
   * Returns raw objects; caller transforms to the internal Debt model.
   */
  async syncDebts(
    config: Record<string, string>,
    page    = 1,
    perPage = 100,
  ): Promise<{ success: boolean; debts: unknown[]; total: number; error?: string }> {
    const { base_url, username, token } = config

    if (!base_url) {
      return { success: false, debts: [], total: 0, error: 'Collection API not configured' }
    }

    log.info('Collection API: syncing debts', { page, perPage })

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token)    headers['Authorization'] = `Bearer ${token}`
      if (username) headers['X-Username'] = username

      const url = new URL(`${base_url.replace(/\/$/, '')}/debts`)
      url.searchParams.set('page', String(page))
      url.searchParams.set('per_page', String(perPage))

      const res = await fetchWithTimeout(url.toString(), { method: 'GET', headers })
      const data = await res.json() as { debts?: unknown[]; data?: unknown[]; total?: number; error?: string }

      if (res.ok) {
        const debts = (data.debts ?? data.data ?? []) as unknown[]
        log.info('Collection API: synced debts', { count: debts.length, total: data.total })
        return { success: true, debts, total: data.total ?? debts.length }
      }

      return { success: false, debts: [], total: 0, error: data.error ?? `HTTP ${res.status}` }
    } catch (err) {
      return { success: false, debts: [], total: 0, error: err instanceof Error ? err.message : 'Sync failed' }
    }
  },

  /**
   * Pull all customer records from the external system.
   */
  async syncCustomers(
    config: Record<string, string>,
    page    = 1,
    perPage = 100,
  ): Promise<{ success: boolean; customers: unknown[]; total: number; error?: string }> {
    const { base_url, username, token } = config

    if (!base_url) {
      return { success: false, customers: [], total: 0, error: 'Collection API not configured' }
    }

    log.info('Collection API: syncing customers', { page, perPage })

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token)    headers['Authorization'] = `Bearer ${token}`
      if (username) headers['X-Username'] = username

      const url = new URL(`${base_url.replace(/\/$/, '')}/customers`)
      url.searchParams.set('page', String(page))
      url.searchParams.set('per_page', String(perPage))

      const res = await fetchWithTimeout(url.toString(), { method: 'GET', headers })
      const data = await res.json() as { customers?: unknown[]; data?: unknown[]; total?: number; error?: string }

      if (res.ok) {
        const customers = (data.customers ?? data.data ?? []) as unknown[]
        log.info('Collection API: synced customers', { count: customers.length })
        return { success: true, customers, total: data.total ?? customers.length }
      }

      return { success: false, customers: [], total: 0, error: data.error ?? `HTTP ${res.status}` }
    } catch (err) {
      return { success: false, customers: [], total: 0, error: err instanceof Error ? err.message : 'Sync failed' }
    }
  },
}
