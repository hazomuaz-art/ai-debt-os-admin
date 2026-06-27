// Temporal Intelligence Engine — public entry point.
// This is the ONLY function the rest of AI Debt OS should ever call to
// understand a temporal expression. No other file should contain its own
// date/time regex or Date math for interpreting customer messages.
import { loadTemporalKnowledgeBase } from './knowledge-base'
import { runTemporalEngine } from './engine'
import type { TemporalContext, TemporalResolution } from './types'

export type { TemporalContext, TemporalResolution, ReferenceType, Confidence } from './types'
export { TEMPORAL_ENGINE_VERSION } from './types'

export async function resolveTemporalExpression(text: string, context: TemporalContext): Promise<TemporalResolution> {
  const kb = await loadTemporalKnowledgeBase(context.countryCode, context.companyId)
  return runTemporalEngine(text, context, kb)
}

// Test-only seam: lets tests inject a fully-controlled KB snapshot instead
// of hitting Supabase, without changing the public API callers use.
export { runTemporalEngine as __resolveWithExplicitKnowledgeBaseForTests } from './engine'
