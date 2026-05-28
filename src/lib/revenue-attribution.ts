export function calculateRevenueAttribution(params: {
  recovered_amount: number
  ai_actions_count: number
  automation_triggered?: boolean
  portfolio_name?: string
}) {
  const efficiencyScore =
    params.ai_actions_count > 0
      ? Math.round(params.recovered_amount / params.ai_actions_count)
      : 0

  return {
    recovered_amount: params.recovered_amount,
    ai_actions_count: params.ai_actions_count,
    automation_triggered: params.automation_triggered ?? false,
    portfolio_name: params.portfolio_name ?? 'unknown',

    efficiency_score: efficiencyScore,

    performance:
      efficiencyScore >= 5000 ? 'excellent' :
      efficiencyScore >= 2000 ? 'good' :
      efficiencyScore >= 500 ? 'average' :
      'low'
  }
}
