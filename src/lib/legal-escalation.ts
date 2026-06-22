import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import type { InsuranceObjectionSignals, InsuranceCaseFile } from '@/lib/insurance-engine'

const log = createLogger('legal-escalation')

export type EscalationType =
  | 'legal_threat' | 'lawyer_mention' | 'complaint'
  | 'fault_dispute' | 'recourse_dispute' | 'third_party_dispute' | 'recovered_deduction'
  | 'playbook_mandated'

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
}): { escalation_type: EscalationType; reason: string } | null {
  const t = args.text

  if (hasAny(t, ['محامي', 'المحامي', 'محاميي', 'lawyer', 'attorney'])) {
    return { escalation_type: 'lawyer_mention', reason: `العميل ذكر محامياً: "${t}"` }
  }
  if (hasAny(t, ['قضية', 'دعوى', 'قضائي', 'المحكمة', 'محكمة', 'court', 'lawsuit', 'sue'])) {
    return { escalation_type: 'legal_threat', reason: `العميل ذكر إجراءً قانونياً/قضائياً: "${t}"` }
  }
  if (hasAny(t, ['شكوى رسمية', 'برفع شكوى', 'بلاغ رسمي', 'هقدم شكوى', 'official complaint'])) {
    return { escalation_type: 'complaint', reason: `العميل ذكر شكوى رسمية: "${t}"` }
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

  return null
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
}

// The ONLY reply allowed while a debt is under legal escalation — fixed,
// deterministic, zero LLM call. No negotiation, no pressure, no payment
// request, no discount/installment offer, ever.
export function renderLegalPersonaReply(escalationType: EscalationType): string {
  const label = ESCALATION_TYPE_LABELS[escalationType] ?? 'مراجعة قانونية'
  return `معك إدارة الشؤون القانونية. ملفك محوّل للمراجعة القانونية حالياً بخصوص: ${label}. سيتم التواصل معك من الجهة المختصة، ولا داعي لمتابعة الموضوع مع المحصّل.`
}
