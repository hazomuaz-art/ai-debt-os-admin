import { chooseNegotiationStrategy } from './negotiation-strategy'
import { detectCustomerIntent } from './negotiation-intent'

export function generateNegotiationResponse(message: string) {
  const intent = detectCustomerIntent(message)
  const strategy = chooseNegotiationStrategy(intent)

  let response = 'خلنا نمشيها خطوة واضحة ونقفل الموضوع بأفضل حل ممكن.'

  switch (strategy.strategy) {
    case 'greet':
      response = 'وعليكم السلام'
      break

    case 'close_payment':
      response = 'تمام، خلنا نثبت السداد ونحدث الملف مباشرة.'
      break

    case 'verify_payment':
      response = 'إذا تم السداد أرسل الإيصال هنا عشان نراجع الحالة.'
      break

    case 'review_installment':
      response = 'أقدر أرفع طلبك للمراجعة حسب سياسة الجهة، لكن ما أقدر أعتمده لك مباشرة من هنا.'
      break

    case 'handle_hardship':
      response = 'واضح إن عندك ظرف، خلنا نشوف أقرب مبلغ تقدر تلتزم فيه بدل ما تبقى المطالبة مفتوحة.'
      break

    case 'handle_delay':
      response = 'التأجيل بدون موعد واضح ما يساعدك، نحتاج تاريخ محدد أو خطوة واضحة نثبتها على الملف.'
      break

    case 'handle_dispute':
      response = 'إذا عندك اعتراض على المطالبة أرسل ما يثبت، ونرفعها للمراجعة.'
      break

    case 'handle_wrong_number':
      response = 'تمام، بنراجع الرقم ونحدث الملف إذا ثبت أنه ما يخصك.'
      break

    case 'deescalate':
      response = 'فاهم عليك، خلنا نحل الموضوع بهدوء بدل ما يطول أكثر.'
      break

    case 'persuade':
      response = 'رفض السداد ما يقفل المطالبة، الأفضل نحدد خطوة عملية تنهي الموضوع.'
      break

    case 'inform_and_progress':
      response = 'المطالبة ظاهرة في الملف، ونقدر نراجع أي اعتراض أو إثبات سداد ترسله هنا.'
      break

    case 'secure_commitment':
      response = 'تمام، أحتاج منك تاريخ واضح ومبلغ محدد عشان أثبت الوعد على الملف.'
      break

    default:
      response = 'وضح لي النقطة الأساسية عشان أقدر أمشي معك في الإجراء الصحيح.'
  }

  return {
    intent,
    strategy: strategy.strategy,
    tone: strategy.tone,
    goal: strategy.goal,
    response
  }
}
