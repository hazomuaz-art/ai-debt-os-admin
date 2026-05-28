export type CustomerIntent =
  | "payment_intent"
  | "installment_request"
  | "complaint"
  | "refusal"
  | "information_request"
  | "unknown"

export function detectCustomerIntent(message: string): CustomerIntent {
  const text = message.toLowerCase()

  if (
    text.includes("بسدد") ||
    text.includes("سداد") ||
    text.includes("ادفع") ||
    text.includes("payment")
  ) {
    return "payment_intent"
  }

  if (
    text.includes("تقسيط") ||
    text.includes("قسط") ||
    text.includes("installment")
  ) {
    return "installment_request"
  }

  if (
    text.includes("شكوى") ||
    text.includes("مشكلة") ||
    text.includes("complaint")
  ) {
    return "complaint"
  }

  if (
    text.includes("ما بسدد") ||
    text.includes("رافض") ||
    text.includes("رفض")
  ) {
    return "refusal"
  }

  if (
    text.includes("كيف") ||
    text.includes("متى") ||
    text.includes("what") ||
    text.includes("how")
  ) {
    return "information_request"
  }

  return "unknown"
}
