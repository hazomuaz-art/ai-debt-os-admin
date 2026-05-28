export interface LearningEvent {
  collector_id: string
  strategy: string
  outcome: 'success' | 'failure'
  amount?: number
}

export function calculateLearningScore(events: LearningEvent[]) {
  const total = events.length

  const successes = events.filter(
    e => e.outcome === 'success'
  ).length

  const successRate =
    total > 0
      ? Math.round((successes / total) * 100)
      : 0

  const topStrategies = Object.entries(
    events.reduce((acc, e) => {
      if (e.outcome === 'success') {
        acc[e.strategy] = (acc[e.strategy] ?? 0) + 1
      }
      return acc
    }, {} as Record<string, number>)
  )
    .sort((a, b) => b[1] - a[1])

  return {
    total_events: total,
    success_rate: successRate,
    top_strategies: topStrategies.slice(0, 5),
  }
}
