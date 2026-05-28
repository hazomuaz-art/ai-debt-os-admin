export function attributeAIRevenue(params: {
  payment_amount: number
  ai_action_type?: string
  strategy?: string
  days_after_ai_action?: number
}) {
  const influenced_by_ai =
    !!params.ai_action_type &&
    (params.days_after_ai_action ?? 999) <= 14

  const attribution_strength =
    !influenced_by_ai ? 'none' :
    (params.days_after_ai_action ?? 999) <= 2 ? 'strong' :
    (params.days_after_ai_action ?? 999) <= 7 ? 'medium' :
    'weak'

  return {
    influenced_by_ai,
    attributed_amount: influenced_by_ai ? params.payment_amount : 0,
    attribution_strength,
    ai_action_type: params.ai_action_type ?? 'unknown',
    strategy: params.strategy ?? 'unknown'
  }
}
