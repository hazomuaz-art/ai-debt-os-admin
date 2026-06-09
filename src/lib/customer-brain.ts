export type CustomerBrain = {
  customerType: string
  conversationStage: string
  language: string
  brokenPromises: number
  openPromises: number
  hasPaymentClaim: boolean
  hasDispute: boolean
  hasInstallmentRequest: boolean
  recommendedTone: string
}

function includesAny(text: string, words: string[]) {
  const value = String(text ?? '').toLowerCase()
  return words.some(word => value.includes(word.toLowerCase()))
}

export function buildCustomerBrain(context: any): CustomerBrain {
  const messages = context?.recent_messages ?? []
  const promises = context?.recent_promises ?? []

  const customerText = messages
    .filter((m: any) => m.direction === 'inbound')
    .map((m: any) => String(m.content ?? ''))
    .join(' ')
    .toLowerCase()

  const brokenPromises = promises.filter((p: any) => p.status === 'broken').length
  const openPromises = promises.filter((p: any) => p.status === 'pending').length

  const hasPaymentClaim = includesAny(customerText, [
    'paid',
    'receipt',
    'transfer',
    'سددت',
    'دفعت',
    'حولت',
    'ايصال',
    'إيصال',
  ])

  const hasDispute = includesAny(customerText, [
    'not mine',
    'wrong amount',
    'dispute',
    'غلط',
    'اعتراض',
    'مو صحيح',
    'ما اعرف',
    'ما أعرف',
  ])

  const hasInstallmentRequest = includesAny(customerText, [
    'installment',
    'installments',
    'تقسيط',
    'اقساط',
    'أقساط',
  ])

  const language = /[a-z]/i.test(customerText) ? 'mixed_or_english' : 'arabic'

  const customerType =
    brokenPromises >= 2
      ? 'procrastinator'
      : openPromises > 0
      ? 'cooperative'
      : 'unknown'

  const conversationStage =
    hasPaymentClaim
      ? 'payment_review'
      : hasDispute
      ? 'dispute'
      : hasInstallmentRequest
      ? 'installment_request'
      : openPromises > 0
      ? 'promise_followup'
      : 'normal'

  const recommendedTone = brokenPromises >= 2 ? 'firm' : 'professional'

  return {
    customerType,
    conversationStage,
    language,
    brokenPromises,
    openPromises,
    hasPaymentClaim,
    hasDispute,
    hasInstallmentRequest,
    recommendedTone,
  }
}