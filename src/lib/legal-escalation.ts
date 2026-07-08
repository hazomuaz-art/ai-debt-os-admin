import { createServiceClient } from '@/lib/supabase/server'
import { insertSystemAlert } from '@/lib/system-alerts'
import { createLogger } from '@/lib/logger'
import type { InsuranceObjectionSignals, InsuranceCaseFile } from '@/lib/insurance-engine'
import type { EscalationRule } from '@/lib/company-playbook'

const log = createLogger('legal-escalation')

export type EscalationType =
  | 'legal_threat' | 'lawyer_mention' | 'complaint'
  | 'fault_dispute' | 'recourse_dispute' | 'third_party_dispute' | 'recovered_deduction'
  | 'playbook_mandated'
  // Owner-specified business rule (2026-06-28): 3+ explicit refusals to pay
  // (signals.refusesToPay), 48h after the first one, with no resolution —
  // opened automatically by the legal-escalation-check cron, never by the
  // live agent directly. Unlike every other type, the lock this opens does
  // NOT use the fixed renderLegalPersonaReply() line — ai-collector-agent.ts
  // generates a real, dynamic, persuasive "lawyer persona" reply per turn
  // instead (see generateLawyerPersonaReply). Never opened for STC, Saudi
  // Energy, or National Water portfolios — excluded explicitly.
  | 'repeated_refusal'
  // Non-freezing review buckets — used for portfolios (e.g. STC) whose
  // policy bans the legal/lockout path entirely. These never go through
  // openEscalation()/the legal persona lock; see recordStcReview() below.
  | 'customer_complaint' | 'stc_review'

function hasAny(text: string, words: string[]) {
  const v = String(text ?? '').trim().toLowerCase()
  return words.some(w => v.includes(w.toLowerCase()))
}

// 🔴 lawyer_mention/legal_threat/complaint used to be detected here by raw
// keyword matching on the customer's text — real production incident
// (customer RAYMOND LASTRELLA BLANCAFLOR, 2026-07-08): the company ran a
// separate SMS campaign whose OWN text mentions "المحامي"/legal wording. A
// customer who pasted/forwarded that SMS into WhatsApp (asking about it) got
// treated as if THEY PERSONALLY were threatening legal action — the keyword
// check has no way to tell "the customer is quoting text we sent them" from
// "the customer is genuinely threatening us", because it never actually
// reads what the message MEANS. This is the same root mistake already fixed
// once for dispute_reason (keyword lists always lag behind and misfire on
// real phrasing) — the fix is identical: the model reads the customer's
// actual message and reports its own semantic verdict
// (parsed.legal_escalation_trigger, in ai-collector-agent.ts) instead of us
// guessing from a fixed word list. Insurance-driven and playbook-driven
// triggers below are untouched — those are data/config-driven, not
// keyword-matched against free-form customer text, so they don't have this
// failure mode.
export function detectMandatoryEscalation(args: {
  text: string
  isInsurancePortfolio: boolean
  insuranceObjection?: InsuranceObjectionSignals | null
  insuranceCase?: InsuranceCaseFile | null
  // Admin-configured ADDITIONAL triggers from this portfolio's Playbook.
  // Checked LAST — a playbook can only ADD escalation triggers, never
  // override, weaken, or replace the insurance-only types (which stay gated
  // on isInsurancePortfolio regardless of what a playbook says).
  customEscalationRules?: EscalationRule[] | null
  // Portfolios whose policy bans the legal/lockout path entirely (e.g. STC).
  // When true, a playbook_mandated trigger from customEscalationRules is
  // refused — this is a code-level guarantee, not just a DB policy, so a
  // legal escalation can never be opened for this debt no matter what is
  // configured in the playbook.
  suppressLegalTriggers?: boolean
}): { escalation_type: EscalationType; reason: string } | null {
  const t = args.text

  // Insurance-specific mandatory escalations — only ever for an actual
  // insurance portfolio, driven by the Phase 3 Insurance Engine's own
  // signals/classification, never guessed here independently.
  if (args.isInsurancePortfolio && args.insuranceObjection) {
    if (args.insuranceObjection.contradictsClaimReason) {
      return { escalation_type: 'recovered_deduction', reason: `العميل قدّم دليلاً مضاداً لسبب المطالبة: "${t}"` }
    }
    if (args.insuranceObjection.objectsToRecourseOrFault) {
      const claimType = args.insuranceCase?.claim_type
      if (claimType === 'recourse') return { escalation_type: 'recourse_dispute', reason: `اعتراض على حق الرجوع/نسبة الخطأ: "${t}"` }
      if (claimType === 'third_party') return { escalation_type: 'third_party_dispute', reason: `اعتراض على مطالبة طرف ثالث: "${t}"` }
      return { escalation_type: 'fault_dispute', reason: `اعتراض على نسبة الخطأ: "${t}"` }
    }
  }

  // Playbook-mandated custom triggers — additive only, checked last. Never
  // honored when suppressLegalTriggers is set, even if a playbook row was
  // hand-edited to include a legal-flavored keyword rule.
  if (!args.suppressLegalTriggers) {
    for (const rule of args.customEscalationRules ?? []) {
      if (Array.isArray(rule.keywords) && rule.keywords.length && hasAny(t, rule.keywords)) {
        return { escalation_type: 'playbook_mandated', reason: rule.reason || `تصعيد إلزامي بسياسة المحفظة: "${t}"` }
      }
    }
  }

  return null
}

// Non-mandatory, NON-freezing review signal — for portfolios like STC where
// a complaint must be logged for human visibility but the conversation
// keeps going normally (no legal persona lock, no debts.status change).
// Deliberately narrower than detectMandatoryEscalation's old 'complaint'
// trigger: only fires on an explicit complaint about the company/service,
// never on legal/lawyer/court language (that's suppressed entirely upstream).
const STC_COMPLAINT_WORDS = [
  'اشتكي', 'أشتكي', 'شكوى', 'شاكي', 'متضايق منكم', 'مستاء منكم',
  'تعامل سيء', 'سوء معاملة', 'موظف وقح', 'تجاوز', 'استياء',
]

export function detectStcReviewSignal(text: string): { escalation_type: 'customer_complaint' | 'stc_review'; reason: string } | null {
  if (hasAny(text, STC_COMPLAINT_WORDS)) {
    return { escalation_type: 'customer_complaint', reason: `شكوى عميل: "${text}"` }
  }
  return null
}

// Logs a customer_complaint/stc_review signal for admin visibility WITHOUT
// freezing the conversation — no legal_escalations row, no debts.status
// change, no legal persona reply. The agent continues the normal
// professional dialogue on this same turn.
export async function recordStcReview(args: {
  company_id: string
  customer_id: string
  debt_id: string
  portfolio_id?: string | null
  escalation_type: 'customer_complaint' | 'stc_review'
  reason: string
}): Promise<void> {
  const supabase = createServiceClient()
  try {
    await insertSystemAlert({
      company_id: args.company_id,
      severity: 'info',
      alert_type: args.escalation_type,
      title: args.escalation_type === 'customer_complaint' ? 'شكوى عميل STC' : 'مراجعة STC مطلوبة',
      message: args.reason,
      metadata: { customer_id: args.customer_id, debt_id: args.debt_id, portfolio_id: args.portfolio_id ?? null },
    })
    // args.escalation_type (e.g. 'customer_complaint') is never a valid
    // timeline_events.event_type — that column only accepts a fixed list
    // (whatsapp_in/whatsapp_out/.../escalation/...). Using 'escalation'
    // here (the real dynamic value is still preserved in summary/detail)
    // is what actually lets this insert succeed instead of silently
    // failing every time, which is what was happening before.
    const { error: teErr } = await supabase.from('timeline_events').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      event_type: 'escalation', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: args.escalation_type, detail: args.reason, occurred_at: new Date().toISOString(),
    })
    if (teErr) log.warn('recordStcReview timeline insert failed: ' + teErr.message, { debt_id: args.debt_id })
  } catch (err) {
    log.warn('recordStcReview failed: ' + (err instanceof Error ? err.message : String(err)), { debt_id: args.debt_id })
  }
}

// The negotiation lock — checked at the very top of runCollectorAgent,
// before anything else (including the LLM). Returns the open escalation
// row if one exists for this debt, or null if the agent may proceed
// normally.
export async function getOpenEscalation(company_id: string, debt_id: string) {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('legal_escalations')
    .select('id, escalation_type, reason, opened_at')
    .eq('company_id', company_id)
    .eq('debt_id', debt_id)
    .eq('status', 'open')
    .maybeSingle()
  return data ?? null
}

export async function openEscalation(args: {
  company_id: string
  customer_id: string
  debt_id: string
  portfolio_id?: string | null
  escalation_type: EscalationType
  reason: string
}): Promise<string | null> {
  const supabase = createServiceClient()
  try {
    const { data, error } = await supabase
      .from('legal_escalations')
      .insert({
        company_id: args.company_id,
        customer_id: args.customer_id,
        debt_id: args.debt_id,
        portfolio_id: args.portfolio_id ?? null,
        escalation_type: args.escalation_type,
        reason: args.reason,
      })
      .select('id')
      .single()

    if (error) {
      // 23505 = an escalation is already open for this debt (idempotent —
      // the unique partial index does its job, not a real failure).
      if ((error as { code?: string }).code === '23505') {
        log.info('escalation already open for this debt — not duplicating', { debt_id: args.debt_id })
        return null
      }
      log.warn('failed to open legal escalation: ' + error.message, { debt_id: args.debt_id })
      return null
    }

    // Real gap found during a deep follow-up audit: not checked — a rejected
    // update would leave the debt in its old status while the
    // legal_escalations row + critical alert + timeline all say it's under
    // legal review, an inconsistent state (the conversation lock itself is
    // driven by getOpenEscalation() reading legal_escalations, not this
    // status field, so replies would still correctly freeze — but every
    // status-based view/filter in the dashboard would show it wrong).
    const { error: debtLegalStatusErr } = await supabase.from('debts').update({ status: 'legal' }).eq('id', args.debt_id)
    if (debtLegalStatusErr) log.warn('failed to set debt status to legal: ' + debtLegalStatusErr.message, { debt_id: args.debt_id })

    await insertSystemAlert({
      company_id: args.company_id,
      severity: 'critical',
      alert_type: 'legal_escalation',
      title: 'تصعيد قانوني جديد',
      message: `تم تصعيد ملف العميل قانونياً — السبب: ${args.reason}`,
      metadata: { customer_id: args.customer_id, debt_id: args.debt_id, escalation_type: args.escalation_type },
    })

    // Same bug, more serious here: 'legal_escalation' was never a valid
    // event_type either (real value is in summary instead) — meant every
    // critical legal escalation ever opened silently never showed up in
    // the timeline. This catch block also could never have caught a
    // constraint-violation failure here even before this fix, since
    // Supabase JS returns {error} rather than throwing — checking it
    // explicitly now.
    const { error: teErr } = await supabase.from('timeline_events').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      event_type: 'escalation', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: `تصعيد قانوني (${args.escalation_type})`, detail: args.reason,
      occurred_at: new Date().toISOString(),
    })
    if (teErr) log.warn('openEscalation timeline insert failed: ' + teErr.message, { debt_id: args.debt_id })

    return (data as { id: string }).id
  } catch (err) {
    log.warn('openEscalation failed: ' + (err instanceof Error ? err.message : String(err)), { debt_id: args.debt_id })
    return null
  }
}

const ESCALATION_TYPE_LABELS: Record<EscalationType, string> = {
  legal_threat: 'تهديد/إجراء قانوني',
  lawyer_mention: 'ذكر محامٍ',
  complaint: 'شكوى رسمية',
  fault_dispute: 'اعتراض نسبة خطأ',
  recourse_dispute: 'اعتراض حق رجوع',
  third_party_dispute: 'نزاع طرف ثالث',
  recovered_deduction: 'مراجعة حذف مسترد',
  playbook_mandated: 'تصعيد إلزامي بالسياسة',
  repeated_refusal: 'رفض/مماطلة متكررة',
  customer_complaint: 'شكوى عميل',
  stc_review: 'مراجعة عميل',
}

// The ONLY reply allowed while a debt is under legal escalation — fixed,
// deterministic, zero LLM call. No negotiation, no pressure, no payment
// request, no discount/installment offer, ever. Does NOT apply to
// 'repeated_refusal' — that type uses generateLawyerPersonaReply() instead
// (a real, dynamic, persuasive reply), called separately by the caller.
export function renderLegalPersonaReply(escalationType: EscalationType): string {
  const label = ESCALATION_TYPE_LABELS[escalationType] ?? 'مراجعة قانونية'
  return `معك إدارة الشؤون القانونية. ملفك محوّل للمراجعة القانونية حالياً بخصوص: ${label}. سيتم التواصل معك من الجهة المختصة، ولا داعي لمتابعة الموضوع مع المحصّل.`
}

// خالد's OWN last message the exact turn the repeated-refusal threshold is
// crossed — announces the handoff to the customer directly, from the SAME
// number, before the lawyer persona takes over on every turn after this one.
export function renderRepeatedRefusalNotice(): string {
  return 'واضح إنك رافض السداد بشكل قاطع. راح يتواصل معك القسم القانوني بالشركة خلال 24 ساعة من نفس هذا الرقم لمتابعة الموضوع رسمياً.'
}

// 3+ explicit refusals (signals.refusesToPay) in the SAME live conversation
// is treated as decisive on its own — no separate waiting period. Exported
// so both the live agent (immediate reaction) and the legal-escalation-check
// cron (slow safety net, in case the inline path ever fails to write) use
// the identical number.
export const REFUSAL_THRESHOLD = 3

// ── Repeated-refusal tracking ──
// 🔴 Real gap found live (customer حذيفه, 2026-07-08): the customer refused
// payment explicitly 5+ times within about one hour, in one continuous
// conversation, and NOTHING escalated — this counter only ever fed a
// cron that additionally required 48 HOURS to pass since the first refusal
// before it would act, and the customer was never told anything was
// happening in the meantime. Now returns the live count so the caller
// (ai-collector-agent.ts) can react the SAME turn the threshold is crossed —
// open the escalation immediately and tell the customer directly, instead of
// silently waiting up to two days for a slow batch job to notice.
export async function trackRefusalForLegalEscalation(args: { debt_id: string }): Promise<{ count: number; first_at: string } | null> {
  const supabase = createServiceClient()
  try {
    const { data: debt } = await supabase.from('debts').select('metadata').eq('id', args.debt_id).maybeSingle()
    const meta = ((debt as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
    const existing = meta.refusal_tracking as { count?: number; first_at?: string } | undefined
    const count = (existing?.count ?? 0) + 1
    const first_at = existing?.first_at ?? new Date().toISOString()
    const { error: trackErr } = await supabase.from('debts').update({
      metadata: { ...meta, refusal_tracking: { count, first_at } },
    }).eq('id', args.debt_id)
    // A silent failure here means the refusal count never actually
    // increments — the repeated_refusal auto-escalation would never
    // trigger for a genuinely repeat-refusing customer, with no trace at all
    // (the try/catch alone can't catch this — Supabase returns {error}
    // rather than throwing).
    if (trackErr) { log.warn('failed to persist refusal tracking: ' + trackErr.message, { debt_id: args.debt_id }); return null }
    return { count, first_at }
  } catch (err) {
    log.warn('trackRefusalForLegalEscalation failed: ' + (err instanceof Error ? err.message : String(err)), { debt_id: args.debt_id })
    return null
  }
}

// Clears the counter once an escalation actually opens (or the debt is
// otherwise resolved) so it doesn't immediately re-trigger after closing.
export async function resetRefusalTracking(debt_id: string): Promise<void> {
  const supabase = createServiceClient()
  try {
    const { data: debt } = await supabase.from('debts').select('metadata').eq('id', debt_id).maybeSingle()
    const meta = ((debt as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>
    const { refusal_tracking, ...rest } = meta
    void refusal_tracking
    const { error: resetErr } = await supabase.from('debts').update({ metadata: rest }).eq('id', debt_id)
    if (resetErr) log.warn('failed to reset refusal tracking: ' + resetErr.message, { debt_id })
  } catch (err) {
    log.warn('resetRefusalTracking failed: ' + (err instanceof Error ? err.message : String(err)), { debt_id })
  }
}

// ── Dynamic "lawyer persona" reply for the 'repeated_refusal' lock ──
// Unlike every other escalation type (fixed, zero-LLM-call reply), this
// type is meant to actually converse: a professional, formal Saudi legal
// advisor persona explaining the GENERAL legal consequences of unpaid debt
// (commercial/consumer collection, enforcement law, the right to pursue the
// matter through the competent judicial/execution authorities) and trying
// to persuade the customer to settle or commit to a real payment date —
// without citing specific article/law numbers (to avoid stating inaccurate
// legal detail) and without ever threatening unprofessionally. Falls back
// to the fixed renderLegalPersonaReply() line on any API failure.
export async function generateLawyerPersonaReply(args: {
  customerMessage: string
  caseSummary: string
  reason: string
}): Promise<string> {
  if (!process.env.OPENROUTER_API_KEY) return renderLegalPersonaReply('repeated_refusal')
  try {
    const OpenAI = (await import('openai')).default
    const client = new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY, baseURL: 'https://openrouter.ai/api/v1' })
    const systemPrompt = `أنت "المستشار القانوني" — محامٍ سعودي محترف يتابع ملفات الديون المتأخرة بعد تكرار رفض العميل السداد أو مماطلته المستمرة (السبب: ${args.reason}).

أسلوبك:
- فصحى قانونية رسمية مبسطة (لا عامية، لا لهجة "خالد" المحصّل السابقة) — جملك واضحة ومباشرة، هادئة وحازمة، لا تستجدي ولا تهدد بأسلوب غير مهني.
- تشرح للعميل بشكل عام (بدون ذكر أرقام مواد أو أنظمة محددة لأنك لا تملك مرجعاً قانونياً دقيقاً الآن) أن الدين المتأخر يبقى حقاً واجب السداد، وأن الجهة الدائنة تملك حق اتخاذ الإجراءات النظامية اللازمة عبر الجهات المختصة (مثل جهات التنفيذ أو القضاء) إن لم تتم تسوية الملف وديّاً.
- هدفك الحقيقي: إقناعه بالتعاون والوصول لتسوية أو تحديد موعد سداد فعلي **الآن**، قبل تصعيد الإجراءات أكثر — أنت لا تريد الوصول للتصعيد القانوني الكامل، وتفضّل الحل الودي إن استجاب.
- إن أعطى العميل تاريخاً أو مبلغاً فعلياً جديداً، تعامل معه بشكل بنّاء واعترف بجهده، لكن وضّح أن الملف يبقى تحت المراجعة القانونية حتى يتم السداد الفعلي.
- رد بجملتين إلى ثلاث جمل كحد أقصى، فصيحة ومباشرة.

ملف القضية: ${args.caseSummary}`

    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-5',
      temperature: 0.5,
      max_tokens: 220,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: args.customerMessage },
      ],
    })
    const text = completion.choices?.[0]?.message?.content?.trim()
    return text || renderLegalPersonaReply('repeated_refusal')
  } catch (err) {
    log.warn('generateLawyerPersonaReply failed — falling back to fixed line: ' + (err instanceof Error ? err.message : String(err)), {})
    return renderLegalPersonaReply('repeated_refusal')
  }
}
