// Module-level burst/lock state for the WAHA inbound webhook (src/app/api/whatsapp/waha-webhook/route.ts).
// Extracted out of the route file (2026-07-13) because Next.js's typed-routes
// checker only allows a route.ts to export HTTP handlers (GET/POST/etc.) plus
// a small set of reserved config names — any other export, including a
// test-only reset helper, fails `tsc --noEmit` once `.next/types` is
// regenerated fresh. This was pre-existing latent breakage (masked only by a
// stale `.next/types` cache) that blocked the deploy pipeline's typecheck
// gate; unrelated to the webhook's actual behavior, which is unchanged here.
export const pendingBursts = new Map<string, { texts: string[]; timer: ReturnType<typeof setTimeout>; latestTimestamp: string }>()
export const processingCustomers = new Set<string>()
export const authAlertState = { lastAt: 0 }

// Test-only: this state is module-level (correct for the real single-process
// server, where it must outlive any one request), but that means it isn't
// naturally reset between test cases the way per-request state is — exported
// so test setup can clear it between cases.
export function __resetWahaWebhookStateForTests(): void {
  processingCustomers.clear()
  pendingBursts.clear()
  authAlertState.lastAt = 0
}
