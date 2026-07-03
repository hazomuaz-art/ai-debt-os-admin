import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'

const log = createLogger('conversation-gates')

function hasAny(text: string, words: string[]) {
  const v = String(text ?? '').trim().toLowerCase()
  return words.some(w => v.includes(w.toLowerCase()))
}

// ════════════════════════════════════════════════════════════════════
//  §3 — Severe distress gate (crisis circuit breaker, not crisis response)
//  Pre-model, checked before EVERYTHING else including identity. Detects
//  acute psychological distress signals tied to the debt. This only stops
//  the collection conversation and routes to a human — it does not attempt
//  any intervention itself.
// ════════════════════════════════════════════════════════════════════
const DISTRESS_PATTERNS = [
  'بنتحر', 'بقتل نفسي', 'بخلص حياتي', 'مو قادر اتحمل', 'تعبت من الحياة',
  'ما ابقى عايش', 'افضل اموت', 'بروح اموت', 'حياتي خلصت', 'ماعاد أقدر أتحمل',
  'ماعاد اقدر اتحمل', 'سويت اللي علي', 'راح أسوي بنفسي شي', 'تعبت نفسياً', 'منهار نفسياً',
]

export function detectSevereDistress(text: string): boolean {
  return hasAny(text, DISTRESS_PATTERNS)
}

export function renderDistressReply(): string {
  return 'وصلتني رسالتك وأنا آخذها بجدية تامة. راح يتواصل معك أحد من فريقنا مباشرة، وما راح أتابع موضوع السداد الآن.'
}

// ════════════════════════════════════════════════════════════════════
//  §2 — Stop-contact / opt-out gate
// ════════════════════════════════════════════════════════════════════
const OPT_OUT_PATTERNS = [
  'وقف الرسائل', 'وقف التواصل', 'لا تتواصلوا معي', 'لا تتواصلون معي', 'بلش التواصل',
  'ما ابغى رسائل', 'ماابغى رسائل', 'وقفوا الرسائل', 'بلغ الجهة المختصة', 'هذا تحرش',
  'توقفوا عن مراسلتي', 'سوف ابلغ', 'بقدم شكوى ضدكم بسبب الرسائل', 'stop messaging', 'unsubscribe',
]

export function detectOptOutIntent(text: string): boolean {
  return hasAny(text, OPT_OUT_PATTERNS)
}

export function renderOptOutConfirmation(): string {
  return 'تم. لن نتواصل معك مرة أخرى عبر هذي القناة، وسيتم تحويل ملفك للمتابعة من فريقنا حسب سياسة الشركة.'
}

// ════════════════════════════════════════════════════════════════════
//  §1 — Identity verification gate
//  customers.national_id holds the FULL number — never re-stored anywhere
//  else; only the last 4 digits are ever compared, and only in-memory.
// ════════════════════════════════════════════════════════════════════
export type VerificationStatus = 'unverified' | 'verified' | 'locked'

export const MAX_VERIFICATION_ATTEMPTS = 2

// Pulls a 4-digit run out of free text, e.g. "آخر اربعة 1234" or just "1234".
export function extractLast4Candidate(text: string): string | null {
  const ascii = String(text ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  const m = ascii.match(/\b(\d{4})\b/)
  return m ? m[1] : null
}

export function nationalIdLast4(nationalId: string | null | undefined): string | null {
  const digits = String(nationalId ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? digits.slice(-4) : null
}

// Questions that never require disclosing customer-specific data and are
// therefore always safe to answer pre-verification.
export function isSafePreVerificationIntent(args: { isGreeting: boolean; asksWhoAreYou: boolean }): boolean {
  return args.isGreeting || args.asksWhoAreYou
}

export type CustomerGateState = {
  verification_status: VerificationStatus
  verification_attempts_count: number
  contact_opt_out: boolean
  pending_clarification: { originalMessage: string; missingField: string } | null
  national_id: string | null
}

export async function getCustomerGateState(customer_id: string): Promise<CustomerGateState> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('customers')
    .select('verification_status, verification_attempts_count, contact_opt_out, pending_clarification, national_id')
    .eq('id', customer_id)
    .maybeSingle()
  const d = (data ?? {}) as any
  return {
    verification_status: (d.verification_status ?? 'unverified') as VerificationStatus,
    verification_attempts_count: d.verification_attempts_count ?? 0,
    contact_opt_out: !!d.contact_opt_out,
    pending_clarification: d.pending_clarification ?? null,
    national_id: d.national_id ?? null,
  }
}

export async function recordVerificationAttempt(args: {
  company_id: string
  customer_id: string
  field_challenged: 'national_id_last4' | 'date_of_birth'
  success: boolean
}): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('verification_attempts').insert({
    company_id: args.company_id,
    customer_id: args.customer_id,
    field_challenged: args.field_challenged,
    success: args.success,
  })
  if (error) log.error('failed to record verification attempt', { error: error.message })
}

export async function markVerified(customer_id: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('customers').update({
    verification_status: 'verified',
    verified_at: new Date().toISOString(),
  }).eq('id', customer_id)
  if (error) log.error('failed to mark customer verified', { error: error.message, customer_id })
}

export async function incrementFailedVerification(customer_id: string, newCount: number): Promise<void> {
  const supabase = createServiceClient()
  const locked = newCount >= MAX_VERIFICATION_ATTEMPTS
  const { error } = await supabase.from('customers').update({
    verification_attempts_count: newCount,
    verification_status: locked ? 'locked' : 'unverified',
  }).eq('id', customer_id)
  if (error) log.error('failed to update verification attempt count', { error: error.message, customer_id })
}

// Real gap found during a full-system audit: not checked — a customer
// explicitly asking to stop being contacted got the confirmation reply
// either way (renderOptOutConfirmation is text, sent regardless), but if
// this update silently failed the flag never actually persisted, so the
// system kept messaging someone who was told they'd been opted out.
export async function setContactOptOut(customer_id: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('customers').update({
    contact_opt_out: true,
    contact_opt_out_at: new Date().toISOString(),
  }).eq('id', customer_id)
  if (error) log.error('failed to set contact opt-out', { error: error.message, customer_id })
}

export async function raiseUrgentHumanAlert(args: {
  company_id: string
  customer_id: string
  debt_id?: string | null
  alert_type: string
  title: string
  message: string
}): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('system_alerts').insert({
    company_id: args.company_id,
    severity: 'critical',
    alert_type: args.alert_type,
    title: args.title,
    message: args.message,
    metadata: { customer_id: args.customer_id, debt_id: args.debt_id ?? null },
  })
  if (error) log.error('failed to insert urgent human alert', { error: error.message })
}

// ════════════════════════════════════════════════════════════════════
//  §4 — Multi-portfolio clarification memory
// ════════════════════════════════════════════════════════════════════
export async function setPendingClarification(customer_id: string, originalMessage: string, missingField = 'company'): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('customers').update({
    pending_clarification: { originalMessage, missingField },
  }).eq('id', customer_id)
  if (error) log.error('failed to set pending clarification', { error: error.message, customer_id })
}

export async function clearPendingClarification(customer_id: string): Promise<void> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('customers').update({ pending_clarification: null }).eq('id', customer_id)
  if (error) log.error('failed to clear pending clarification', { error: error.message, customer_id })
}

// ════════════════════════════════════════════════════════════════════
//  §8 — Anti-robotic reply variants: never repeat the same canned line
//  twice within one conversation. `scope` separates independently-tracked
//  pools (e.g. 'anti_repetition' vs 'repeated_question') on the same customer.
// ════════════════════════════════════════════════════════════════════
export async function pickUnusedVariant(customer_id: string, scope: string, pool: string[]): Promise<string> {
  if (!pool.length) return ''
  const supabase = createServiceClient()
  const { data } = await supabase.from('customers').select('used_reply_variants').eq('id', customer_id).maybeSingle()
  const used: number[] = Array.isArray((data as any)?.used_reply_variants?.[scope]) ? (data as any).used_reply_variants[scope] : []
  let candidates = pool.map((_, i) => i).filter(i => !used.includes(i))
  if (!candidates.length) candidates = pool.map((_, i) => i) // exhausted the pool — start over
  const chosenIdx = candidates[Math.floor(Math.random() * candidates.length)]
  const newUsed = [...used, chosenIdx].slice(-Math.max(1, pool.length - 1)) // never block the entire pool
  try {
    const { data: row } = await supabase.from('customers').select('used_reply_variants').eq('id', customer_id).maybeSingle()
    const current = (row as any)?.used_reply_variants ?? {}
    const { error: variantUpdErr } = await supabase.from('customers').update({ used_reply_variants: { ...current, [scope]: newUsed } }).eq('id', customer_id)
    if (variantUpdErr) log.warn('failed to persist used reply variant', { error: variantUpdErr.message })
  } catch (err) {
    log.warn('failed to persist used reply variant', { error: String((err as any)?.message ?? err) })
  }
  return pool[chosenIdx]
}
