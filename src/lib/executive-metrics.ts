export function calculateExecutiveMetrics(params: {
  total_debts: number
  recovered_debts: number
  total_amount: number
  recovered_amount: number
  high_risk_cases: number
}) {
  const collection_rate =
    params.total_amount > 0
      ? Math.round(
          (params.recovered_amount / params.total_amount) * 100
        )
      : 0

  const ai_recovery_rate =
    params.total_debts > 0
      ? Math.round(
          (params.recovered_debts / params.total_debts) * 100
        )
      : 0

  return {
    collection_rate,
    ai_recovery_rate,
    active_cases:
      params.total_debts - params.recovered_debts,

    recovered_amount: params.recovered_amount,

    high_risk_cases: params.high_risk_cases
  }
}
