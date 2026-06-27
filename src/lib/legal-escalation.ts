import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import type { InsuranceObjectionSignals, InsuranceCaseFile } from '@/lib/insurance-engine'
import type { EscalationRule } from '@/lib/company-playbook'

const log = createLogger('legal-escalation')

export type EscalationType =
  | 'legal_threat' | 'lawyer_mention' | 'complaint'
  | 'fault_dispute' | 'recourse_dispute' | 'third_party_dispute' | 'recovered_deduction'
  | 'playbook_mandated'
  // Non-freezing review buckets — used for portfolios (e.g. STC) whose
  // policy bans the legal/lockout path entirely. These never go through
  // openEscalation()/the legal persona lock; see recordStcReview() below.
  | 'customer_complaint' | 'stc_review'

function hasAny(text: string, words: string[]) {
  const v = String(text ?? '').trim().toLowerCase()
  return words.some(w => v.includes(w.toLowerCase()))
}

// 100% deterministic, keyword/data-driven — never an LLM judgment call.
// Checked BEFORE any negotiation logic runs.
export function detectMandatoryEscalation(args: {
  text: string
  isInsurancePortfolio: boolean
  insuranceObjection?: InsuranceObjectionSignals | null
  insuranceCase?: InsuranceCaseFile | null
  // Admin-configured ADDITIONAL triggers from this portfolio's Playbook.
  // Checked LAST, after every hard-coded rule below — a playbook can only
  // ADD escalation triggers, never override, weaken, or replace the fixed
  // ones (lawyer/legal/complaint, or the insurance-only types which stay
  // gated on isInsurancePortfolio regardless of what a playbook says).
  customEscalationRules?: EscalationRule[] | null
  // Portfolios whose policy bans the legal/lockout path entirely (e.g. STC).
  // When true, none of the hard-coded lawyer/legal/complaint triggers below
  // fire, and a playbook_mandated trigger from customEscalationRules is
  // also refused — this is a code-level guarantee, not just a DB policy,
  // so a legal escalation can never be opened for this debt no matter what
  // is configured in the playbook.
  suppressLegalTriggers?: boolean
}): { escalation_type: EscalationType; reason: string } | null {
  const t = args.text

  if (!args.suppressLegalTriggers) {
    if (hasAny(t, ['محامي', 'المحامي', 'محاميي', 'lawyer', 'attorney'])) {
      return { escalation_type: 'lawyer_mention', reason: `العميل ذكر محامياً: "${t}"` }
    }
    if (hasAny(t, ['قضية', 'دعوى', 'قضائي', 'المحكمة', 'محكمة', 'court', 'lawsuit', 'sue'])) {
      return { escalation_type: 'legal_threat', reason: `العميل ذكر إجراءً قانونياً/قضائياً: "${t}"` }
    }
    if (hasAny(t, ['شكوى رسمية', 'برفع شكوى', 'بلاغ رسمي', 'هقدم شكوى', 'official complaint'])) {
      return { escalation_type: 'complaint', reason: `العميل ذكر شكوى رسمية: "${t}"` }
    }
  }

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
    await supabase.from('system_alerts').insert({
      company_id: args.company_id,
      severity: 'info',
      alert_type: args.escalation_type,
      title: args.escalation_type === 'customer_complaint' ? 'شكوى عميل STC' : 'مراجعة STC مطلوبة',
      message: args.reason,
      metadata: { customer_id: args.customer_id, debt_id: args.debt_id, portfolio_id: args.portfolio_id ?? null },
    })
    await supabase.from('timeline_events').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      event_type: args.escalation_type, channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: args.escalation_type, detail: args.reason, occurred_at: new Date().toISOString(),
    })
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

    await supabase.from('debts').update({ status: 'legal' }).eq('id', args.debt_id)

    await supabase.from('system_alerts').insert({
      company_id: args.company_id,
      severity: 'critical',
      alert_type: 'legal_escalation',
      title: 'تصعيد قانوني جديد',
      message: `تم تصعيد ملف العميل قانونياً — السبب: ${args.reason}`,
      metadata: { customer_id: args.customer_id, debt_id: args.debt_id, escalation_type: args.escalation_type },
    })

    await supabase.from('timeline_events').insert({
      company_id: args.company_id, customer_id: args.customer_id, debt_id: args.debt_id,
      event_type: 'legal_escalation', channel: 'whatsapp', actor_type: 'ai', ai_used: true,
      summary: `تصعيد قانوني (${args.escalation_type})`, detail: args.reason,
      occurred_at: new Date().toISOString(),
    })

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
  customer_complaint: 'شكوى عميل',
  stc_review: 'مراجعة عميل',
}

// The ONLY reply allowed while a debt is under legal escalation — fixed,
// deterministic, zero LLM call. No negotiation, no pressure, no payment
// request, no discount/installment offer, ever.
export function renderLegalPersonaReply(escalationType: EscalationType): string {
  const label = ESCALATION_TYPE_LABELS[escalationType] ?? 'مراجعة قانونية'
  return `معك إدارة الشؤون القانونية. ملفك محوّل للمراجعة القانونية حالياً بخصوص: ${label}. سيتم التواصل معك من الجهة المختصة، ولا داعي لمتابعة الموضوع مع المحصّل.`
}
