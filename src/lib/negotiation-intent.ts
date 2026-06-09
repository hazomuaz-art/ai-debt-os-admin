export type CustomerIntent =
  | "greeting"
  | "payment_intent"
  | "paid_claim"
  | "installment_request"
  | "hardship"
  | "delay"
  | "dispute"
  | "wrong_number"
  | "angry"
  | "refusal"
  | "information_request"
  | "promise"
  | "unknown"

export function detectCustomerIntent(message: string): CustomerIntent {
  const text = message.toLowerCase().trim()

  if (/^(السلام عليكم|سلام عليكم|السلام عليكم ورحمة الله|هلا|مرحبا|هاي|hi|hello)$/.test(text)) {
    return "greeting"
  }

  if (
    text.includes("دفعت") ||
    text.includes("سددت") ||
    text.includes("سددتها") ||
    text.includes("محول") ||
    text.includes("حوالة") ||
    text.includes("ايصال") ||
    text.includes("إيصال") ||
    text.includes("paid")
  ) {
    return "paid_claim"
  }

  if (
    text.includes("بسدد") ||
    text.includes("بسدده") ||
    text.includes("اسدد") ||
    text.includes("أدفع") ||
    text.includes("ادفع") ||
    text.includes("سداد") ||
    text.includes("payment")
  ) {
    return "payment_intent"
  }

  if (
    text.includes("تقسيط") ||
    text.includes("اقسط") ||
    text.includes("أقسط") ||
    text.includes("قسط") ||
    text.includes("دفعات") ||
    text.includes("installment")
  ) {
    return "installment_request"
  }

  if (
    text.includes("ما عندي") ||
    text.includes("ما اقدر") ||
    text.includes("ما أقدر") ||
    text.includes("ظروفي") ||
    text.includes("ظروف") ||
    text.includes("راتب") ||
    text.includes("اذا جاتني") ||
    text.includes("إذا جاتني") ||
    text.includes("فلوس") ||
    text.includes("متعثر")
  ) {
    return "hardship"
  }

  if (
    text.includes("بعد كم يوم") ||
    text.includes("آخر الشهر") ||
    text.includes("اخر الشهر") ||
    text.includes("الشهر الجاي") ||
    text.includes("بعدين") ||
    text.includes("لاحق") ||
    text.includes("انتظر")
  ) {
    return "delay"
  }

  if (
    text.includes("غلط") ||
    text.includes("مو صحيح") ||
    text.includes("غير صحيح") ||
    text.includes("ما اعرف") ||
    text.includes("ما أعرف") ||
    text.includes("وش هذي") ||
    text.includes("حقت شنو") ||
    text.includes("اثبات") ||
    text.includes("إثبات") ||
    text.includes("اعتراض")
  ) {
    return "dispute"
  }

  if (
    text.includes("رقم غلط") ||
    text.includes("ما يخصني") ||
    text.includes("مب رقمي") ||
    text.includes("ليس رقمي") ||
    text.includes("wrong number")
  ) {
    return "wrong_number"
  }

  if (
    text.includes("ازعاج") ||
    text.includes("إزعاج") ||
    text.includes("طفشتونا") ||
    text.includes("لا ترسل") ||
    text.includes("بشتكي") ||
    text.includes("محامي") ||
    text.includes("قاضي") ||
    text.includes("غصب") ||
    text.includes("حرام")
  ) {
    return "angry"
  }

  if (
    text.includes("ما بسدد") ||
    text.includes("ما راح اسدد") ||
    text.includes("ماني مسدد") ||
    text.includes("ارفض") ||
    text.includes("رافض") ||
    text.includes("رفض")
  ) {
    return "refusal"
  }

  if (
    text.includes("متى") ||
    text.includes("كيف") ||
    text.includes("كم") ||
    text.includes("ليش") ||
    text.includes("what") ||
    text.includes("how")
  ) {
    return "information_request"
  }

  if (
    text.includes("اوعدك") ||
    text.includes("بوعدك") ||
    text.includes("يوم") ||
    text.includes("تاريخ") ||
    text.includes("بكرة") ||
    text.includes("بكره")
  ) {
    return "promise"
  }

  return "unknown"
}
