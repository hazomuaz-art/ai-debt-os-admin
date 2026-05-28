import { chooseNegotiationStrategy } from './negotiation-strategy'
import { detectCustomerIntent } from './negotiation-intent'

export function generateNegotiationResponse(message: string) {
  const intent = detectCustomerIntent(message)
  const strategy = chooseNegotiationStrategy(intent)

  let response = ''

  switch (strategy.strategy) {
    case 'close_payment':
      response =
        'نشكركم على تجاوبكم. يمكنكم إتمام السداد الآن وسنقوم بتحديث الحالة مباشرة بعد تأكيد العملية.'
      break

    case 'offer_installment':
      response =
        'نفهم احتياجكم للتقسيط. يمكننا دراسة خطة سداد مناسبة، ما المبلغ الذي تستطيعون الالتزام به شهرياً؟'
      break

    case 'calm_and_resolve':
      response =
        'نقدر ملاحظتكم ونعتذر عن أي إزعاج. نود فهم المشكلة بشكل أفضل للوصول إلى حل مناسب.'
      break

    case 'persuade_and_reframe':
      response =
        'نفهم موقفكم، لكن نوصي بمعالجة الالتزام في أقرب فرصة. يمكننا مناقشة خيارات مناسبة تساعد على التسوية.'
      break

    case 'answer_and_redirect':
      response =
        'يسعدنا توضيح المعلومات المطلوبة، وبعد ذلك يمكننا مساعدتكم في إكمال إجراءات السداد أو التسوية.'
      break

    default:
      response =
        'شكراً لتواصلكم. هل يمكن توضيح طلبكم بشكل أكبر حتى نتمكن من مساعدتكم بصورة أدق؟'
  }

  return {
    intent,
    strategy: strategy.strategy,
    tone: strategy.tone,
    response
  }
}
