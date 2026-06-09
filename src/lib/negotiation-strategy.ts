import type { CustomerIntent } from './negotiation-intent'

export type NegotiationStrategy =
  | "greet"
  | "close_payment"
  | "verify_payment"
  | "review_installment"
  | "handle_hardship"
  | "handle_delay"
  | "handle_dispute"
  | "handle_wrong_number"
  | "deescalate"
  | "persuade"
  | "inform_and_progress"
  | "secure_commitment"
  | "human_review"

export function chooseNegotiationStrategy(intent: CustomerIntent) {
  switch (intent) {
    case "greeting":
      return {
        strategy: "greet" as NegotiationStrategy,
        tone: "friendly",
        goal: "Start conversation naturally"
      }

    case "payment_intent":
      return {
        strategy: "close_payment" as NegotiationStrategy,
        tone: "confident",
        goal: "Move directly toward payment completion"
      }

    case "paid_claim":
      return {
        strategy: "verify_payment" as NegotiationStrategy,
        tone: "professional",
        goal: "Obtain proof of payment"
      }

    case "installment_request":
      return {
        strategy: "review_installment" as NegotiationStrategy,
        tone: "practical",
        goal: "Collect information for installment review"
      }

    case "hardship":
      return {
        strategy: "handle_hardship" as NegotiationStrategy,
        tone: "understanding",
        goal: "Understand capacity and secure realistic commitment"
      }

    case "delay":
      return {
        strategy: "handle_delay" as NegotiationStrategy,
        tone: "firm",
        goal: "Convert delay into a concrete date or action"
      }

    case "dispute":
      return {
        strategy: "handle_dispute" as NegotiationStrategy,
        tone: "objective",
        goal: "Review claim and request supporting information"
      }

    case "wrong_number":
      return {
        strategy: "handle_wrong_number" as NegotiationStrategy,
        tone: "professional",
        goal: "Verify and update contact details"
      }

    case "angry":
      return {
        strategy: "deescalate" as NegotiationStrategy,
        tone: "calm",
        goal: "Reduce tension and move conversation forward"
      }

    case "refusal":
      return {
        strategy: "persuade" as NegotiationStrategy,
        tone: "firm_but_respectful",
        goal: "Understand objection and progress toward resolution"
      }

    case "information_request":
      return {
        strategy: "inform_and_progress" as NegotiationStrategy,
        tone: "clear",
        goal: "Answer question and advance the case"
      }

    case "promise":
      return {
        strategy: "secure_commitment" as NegotiationStrategy,
        tone: "focused",
        goal: "Capture exact promise details"
      }

    default:
      return {
        strategy: "human_review" as NegotiationStrategy,
        tone: "careful",
        goal: "Gather more context safely"
      }
  }
}
