export function analyzePromise(params: {
  promises_count: number
  fulfilled_promises: number
  missed_promises: number
}) {
  const reliability =
    params.promises_count > 0
      ? Math.round(
          (params.fulfilled_promises / params.promises_count) * 100
        )
      : 0

  const promise_status =
    reliability >= 70 ? 'trusted' :
    reliability >= 40 ? 'uncertain' :
    'high_risk'

  const recommendation =
    reliability >= 70
      ? 'Allow AI negotiation'
      : reliability >= 40
      ? 'Require close follow-up'
      : 'Escalate collection process'

  return {
    reliability_score: reliability,
    promise_status,
    recommendation
  }
}
