export function analyzeCollectorPerformance(params: {
  total_cases: number
  recovered_cases: number
  recovered_amount: number
}) {
  const success_rate =
    params.total_cases > 0
      ? Math.round(
          (params.recovered_cases / params.total_cases) * 100
        )
      : 0

  const collector_level =
    success_rate >= 80 ? 'elite' :
    success_rate >= 60 ? 'advanced' :
    success_rate >= 40 ? 'average' :
    'needs_improvement'

  return {
    success_rate,
    collector_level,

    ai_learning_priority:
      collector_level === 'elite'
        ? 'high'
        : collector_level === 'advanced'
        ? 'medium'
        : 'low',

    recovered_amount: params.recovered_amount
  }
}
