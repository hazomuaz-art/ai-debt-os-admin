/**
 * Cost Tracker — logs every AI/API operation to ai_cost_log.
 *
 * OpenAI pricing (gpt-4o-mini, as of mid-2025):
 *   Input:  $0.15 / 1M tokens
 *   Output: $0.60 / 1M tokens
 *
 * Prices are overridden by company cost_settings if present.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import type { CostProvider, CostSettings } from '@/types'

const log = createLogger('cost-tracker')

// Default prices (USD) — overridden by cost_settings table
const DEFAULT_PRICES = {
  openai_input_per_1m:   0.15,
  openai_output_per_1m:  0.60,
  whatsapp_outbound:     0.0500,
  whatsapp_inbound:      0.0050,
  call_analysis_per_min: 0.0240,
  storage_per_gb:        0.0230,
  external_api_per_call: 0.0010,
}

// ── In-memory settings cache (5-min TTL) ────────────────────────────────

const settingsCache = new Map<string, { prices: typeof DEFAULT_PRICES; expiresAt: number }>()

async function getPrices(companyId: string): Promise<typeof DEFAULT_PRICES> {
  const cached = settingsCache.get(companyId)
  if (cached && cached.expiresAt > Date.now()) return cached.prices

  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('cost_settings')
      .select('*')
      .eq('company_id', companyId)
      .single()

    if (data) {
      const prices = {
        openai_input_per_1m:   Number(data.openai_input_per_1m)   || DEFAULT_PRICES.openai_input_per_1m,
        openai_output_per_1m:  Number(data.openai_output_per_1m)  || DEFAULT_PRICES.openai_output_per_1m,
        whatsapp_outbound:     Number(data.whatsapp_outbound)      || DEFAULT_PRICES.whatsapp_outbound,
        whatsapp_inbound:      Number(data.whatsapp_inbound)       || DEFAULT_PRICES.whatsapp_inbound,
        call_analysis_per_min: Number(data.call_analysis_per_min) || DEFAULT_PRICES.call_analysis_per_min,
        storage_per_gb:        Number(data.storage_per_gb)        || DEFAULT_PRICES.storage_per_gb,
        external_api_per_call: Number(data.external_api_per_call) || DEFAULT_PRICES.external_api_per_call,
      }
      settingsCache.set(companyId, { prices, expiresAt: Date.now() + 5 * 60_000 })
      return prices
    }
  } catch { /* use defaults */ }

  return DEFAULT_PRICES
}

// ── Estimate cost ─────────────────────────────────────────────────────────

export function estimateOpenAICost(
  inputTokens:  number,
  outputTokens: number,
  prices = DEFAULT_PRICES,
): number {
  return (
    (inputTokens  / 1_000_000) * prices.openai_input_per_1m +
    (outputTokens / 1_000_000) * prices.openai_output_per_1m
  )
}

// ── Log an operation ──────────────────────────────────────────────────────

export interface LogCostOptions {
  company_id:         string
  provider:           CostProvider
  action_type:        string
  model?:             string
  input_tokens?:      number
  output_tokens?:     number
  total_tokens?:      number
  estimated_cost?:    number   // pass to override auto-calculation
  portfolio_id?:      string
  portfolio_name?:    string
  customer_id?:       string
  customer_reference?: string
  debt_id?:           string
  collector_id?:      string
  collector_name?:    string
  duration_ms?:       number
  success?:           boolean
  error_message?:     string
  metadata?:          Record<string, unknown>
}

export async function logCost(opts: LogCostOptions): Promise<void> {
  try {
    const prices = await getPrices(opts.company_id)

    const inputTokens  = opts.input_tokens  ?? 0
    const outputTokens = opts.output_tokens ?? 0
    const totalTokens  = opts.total_tokens  ?? inputTokens + outputTokens

    let estimatedCost = opts.estimated_cost ?? 0

    if (!opts.estimated_cost) {
      if (opts.provider === 'openai') {
        estimatedCost = estimateOpenAICost(inputTokens, outputTokens, prices)
      } else if (opts.provider === 'whatsapp') {
        estimatedCost = prices.whatsapp_outbound
      } else if (opts.provider === 'tameez' || opts.provider === 'rasf') {
        estimatedCost = prices.call_analysis_per_min
      } else if (opts.provider === 'external') {
        estimatedCost = prices.external_api_per_call
      }
    }

    const supabase = createServiceClient()
    await supabase.from('ai_cost_log').insert({
      company_id:         opts.company_id,
      provider:           opts.provider,
      model:              opts.model ?? null,
      action_type:        opts.action_type,
      input_tokens:       inputTokens,
      output_tokens:      outputTokens,
      total_tokens:       totalTokens,
      estimated_cost:     estimatedCost,
      portfolio_id:       opts.portfolio_id   ?? null,
      portfolio_name:     opts.portfolio_name ?? null,
      customer_id:        opts.customer_id    ?? null,
      customer_reference: opts.customer_reference ?? null,
      debt_id:            opts.debt_id        ?? null,
      collector_id:       opts.collector_id   ?? null,
      collector_name:     opts.collector_name ?? null,
      duration_ms:        opts.duration_ms    ?? null,
      success:            opts.success        ?? true,
      error_message:      opts.error_message  ?? null,
      metadata:           opts.metadata       ?? {},
    })
  } catch (err) {
    // Non-fatal — never let cost tracking break the main flow
    log.warn('Failed to log cost entry', err instanceof Error ? err : new Error(String(err)))
  }
}

// ── Convenience wrappers ──────────────────────────────────────────────────

export async function logOpenAICost(opts: {
  company_id:      string
  action_type:     string
  model:           string
  input_tokens:    number
  output_tokens:   number
  duration_ms?:    number
  portfolio_id?:   string
  portfolio_name?: string
  customer_id?:    string
  debt_id?:        string
  collector_name?: string
  success?:        boolean
  error_message?:  string
}): Promise<void> {
  return logCost({ ...opts, provider: 'openai' })
}

export async function logWhatsAppCost(opts: {
  company_id:      string
  direction:       'outbound' | 'inbound'
  portfolio_name?: string
  customer_id?:    string
  debt_id?:        string
}): Promise<void> {
  const prices = await getPrices(opts.company_id)
  const cost   = opts.direction === 'outbound' ? prices.whatsapp_outbound : prices.whatsapp_inbound

  return logCost({
    company_id:      opts.company_id,
    provider:        'whatsapp',
    action_type:     `whatsapp_${opts.direction}`,
    estimated_cost:  cost,
    portfolio_name:  opts.portfolio_name,
    customer_id:     opts.customer_id,
    debt_id:         opts.debt_id,
  })
}
