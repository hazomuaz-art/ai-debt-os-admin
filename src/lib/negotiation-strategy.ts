import type { CustomerIntent } from './negotiation-intent'

export type NegotiationStrategy =
  | "close_payment"
  | "offer_installment"
  | "calm_and_resolve"
  | "persuade_and_reframe"
  | "answer_and_redirect"
  | "human_review"

export function chooseNegotiationStrategy(intent: CustomerIntent) {
  switch (intent) {
    case "payment_intent":
      return {
        strategy: "close_payment" as NegotiationStrategy,
        tone: "confident",
        goal: "Move customer to immediate payment confirmation"
      }

    case "installment_request":
      return {
        strategy: "offer_installment" as NegotiationStrategy,
        tone: "cooperative",
        goal: "Offer structured payment plan and secure promise date"
      }

    case "complaint":
      return {
        strategy: "calm_and_resolve" as NegotiationStrategy,
        tone: "empathetic",
        goal: "Acknowledge complaint and reduce tension"
      }

    case "refusal":
      return {
        strategy: "persuade_and_reframe" as NegotiationStrategy,
        tone: "firm_but_respectful",
        goal: "Reframe consequences and offer realistic settlement path"
      }

    case "information_request":
      return {
        strategy: "answer_and_redirect" as NegotiationStrategy,
        tone: "clear",
        goal: "Answer question then guide customer to payment action"
      }

    default:
      return {
        strategy: "human_review" as NegotiationStrategy,
        tone: "careful",
        goal: "Avoid wrong response and ask for clarification"
      }
  }
}
