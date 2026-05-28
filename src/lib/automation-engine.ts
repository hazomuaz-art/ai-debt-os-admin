export function determineAutomationAction(params: {
  customer_status: string
  engagement_score: number
  has_promise?: boolean
  has_recent_payment?: boolean
}) {
  if (params.has_recent_payment) {
    return {
      action: 'monitor',
      priority: 'low',
      reason: 'Recent payment detected'
    }
  }

  if (params.has_promise) {
    return {
      action: 'follow_up',
      priority: 'medium',
      reason: 'Customer has active promise'
    }
  }

  if (params.customer_status === 'cold') {
    return {
      action: 'escalate',
      priority: 'high',
      reason: 'Customer not responsive'
    }
  }

  if (params.engagement_score >= 50) {
    return {
      action: 'ai_negotiate',
      priority: 'medium',
      reason: 'Customer responsive and engaged'
    }
  }

  return {
    action: 'monitor',
    priority: 'low',
    reason: 'No action needed'
  }
}
