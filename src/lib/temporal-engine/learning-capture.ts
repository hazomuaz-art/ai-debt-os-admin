import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import type { TemporalContext } from './types'

const log = createLogger('temporal-engine:learning-capture')

// Fire-and-forget by design — a failure to log an unrecognized expression
// must NEVER block or slow down the live conversation. This is pure data
// capture for later human-curated KB updates (see architecture §Learning
// Capture Layer) — it never changes engine behavior on its own.
export async function captureUnrecognizedExpression(args: {
  sourceExpression: string
  fullMessageText: string
  failureReason: string
  context: TemporalContext
}): Promise<void> {
  try {
    const svc = createServiceClient()
    const { error } = await svc.from('temporal_learning').insert({
      company_id: args.context.companyId,
      portfolio_id: args.context.portfolioId,
      country_code: args.context.countryCode,
      customer_id: args.context.customerId,
      debt_id: args.context.debtId,
      source_expression: args.sourceExpression,
      full_message_text: args.fullMessageText,
      engine_failure_reason: args.failureReason,
      detected_at: args.context.messageTimestamp.toISOString(),
    })
    if (error) log.error('failed to capture unrecognized temporal expression', { error: error.message })
  } catch (e) {
    log.error('temporal_learning insert threw', e as Error)
  }
}
