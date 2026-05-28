export function generateExecutiveInsights(params: {
  collection_rate: number
  ai_recovery_rate: number
  high_risk_cases: number
}) {
  const insights: string[] = []

  if (params.collection_rate < 40) {
    insights.push('Collection rate is below target')
  }

  if (params.ai_recovery_rate > 60) {
    insights.push('AI recovery performance is strong')
  }

  if (params.high_risk_cases > 20) {
    insights.push('High number of risky accounts detected')
  }

  if (insights.length === 0) {
    insights.push('System performance is stable')
  }

  return insights
}
