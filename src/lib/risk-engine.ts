export function calculateRiskScore(params: {
  engagement_score: number
  has_payment?: boolean
  has_promise?: boolean
  recent_events?: number
}) {
  let score = 100

  score -= params.engagement_score

  if (params.has_payment) score -= 25
  if (params.has_promise) score -= 15

  score -= Math.min(params.recent_events ?? 0, 10)

  const risk_level =
    score >= 70 ? 'high_risk' :
    score >= 40 ? 'medium_risk' :
    'low_risk'

  const recovery_probability =
    score >= 70 ? 'low' :
    score >= 40 ? 'medium' :
    'high'

  return {
    risk_score: Math.max(score, 0),
    risk_level,
    recovery_probability
  }
}
