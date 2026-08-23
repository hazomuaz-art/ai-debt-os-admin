/** Authoritative model tiers. Call sites choose a workload tier, never a raw model ID. */
export const AI_MODELS = {
  reasoning: 'anthropic/claude-sonnet-5',
  balanced: 'anthropic/claude-sonnet-4',
  fast: 'openai/gpt-4o-mini',
} as const

export type AiModelTier = keyof typeof AI_MODELS
