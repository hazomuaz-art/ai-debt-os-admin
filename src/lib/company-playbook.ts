import { createServiceClient } from '@/lib/supabase/server'

// ════════════════════════════════════════════════════════════════════
//  Company Playbooks — Phase 2
//
//  One policy per portfolio: what topics the agent may discuss, whether
//  discounts/installments exist as a POLICY (never auto-approved by the
//  agent), and which dispute types are valid for that portfolio's sector.
//  Insurance-only concepts (recourse / third-party / recovered deduction)
//  must never leak into a non-insurance portfolio — enforced here by
//  category, not just by what an admin happened to type into the row.
// ════════════════════════════════════════════════════════════════════

export type PortfolioCategory =
  | 'telecom' | 'insurance' | 'utility' | 'recruitment' | 'government' | 'finance' | 'agriculture' | 'other'

export type Playbook = {
  portfolio_id: string
  category: PortfolioCategory
  discounts: { allowed: boolean; max_percent: number; requires_admin_approval: boolean }
  installments: { allowed: boolean; max_months: number; requires_admin_approval: boolean }
  fields_to_surface: string[]
  allowed_dispute_types: string[]
  notes: string | null
  is_default: boolean // true when no row exists in DB and a category default was used
}

// Category defaults — used whenever a portfolio has no saved playbook row
// yet, so the agent is never left with zero policy. Insurance-only dispute
// types appear ONLY in the insurance default; they are hard-coded out of
// every other category's default and stripped again below as a second,
// code-level guarantee even if a row was hand-edited incorrectly.
const INSURANCE_ONLY_DISPUTE_TYPES = ['recourse', 'third_party', 'recovered_deduction']

const CATEGORY_DEFAULTS: Record<PortfolioCategory, Pick<Playbook, 'fields_to_surface' | 'allowed_dispute_types'>> = {
  telecom: {
    fields_to_surface: ['account_number', 'product_number', 'sadad_number', 'invoice_dispute', 'statement_request'],
    allowed_dispute_types: ['wrong_number', 'not_mine', 'wrong_amount', 'already_settled', 'invoice_dispute'],
  },
  insurance: {
    fields_to_surface: ['recovery_number', 'recourse_reason', 'fault_percentage', 'third_party', 'recovered_deduction'],
    allowed_dispute_types: ['recourse', 'third_party', 'recovered_deduction', 'wrong_number', 'not_mine', 'already_settled'],
  },
  utility: {
    fields_to_surface: ['account_number', 'meter_or_subscriber_number', 'payment_proof', 'invoice_dispute'],
    allowed_dispute_types: ['wrong_number', 'not_mine', 'wrong_amount', 'already_settled', 'invoice_dispute'],
  },
  finance: { fields_to_surface: ['account_number', 'reference_number'], allowed_dispute_types: ['wrong_number', 'not_mine', 'wrong_amount', 'already_settled'] },
  recruitment: { fields_to_surface: ['account_number', 'reference_number'], allowed_dispute_types: ['wrong_number', 'not_mine', 'already_settled'] },
  government: { fields_to_surface: ['account_number', 'reference_number'], allowed_dispute_types: ['wrong_number', 'not_mine', 'already_settled'] },
  agriculture: { fields_to_surface: ['account_number', 'reference_number'], allowed_dispute_types: ['wrong_number', 'not_mine', 'already_settled'] },
  other: { fields_to_surface: ['account_number', 'reference_number'], allowed_dispute_types: ['wrong_number', 'not_mine', 'already_settled'] },
}

function sanitizeDisputeTypes(types: string[], category: PortfolioCategory): string[] {
  const list = Array.isArray(types) ? types : []
  // Hard rule, independent of what is actually stored in the DB row: a
  // non-insurance portfolio can NEVER carry insurance-only dispute types.
  if (category === 'insurance') return list
  return list.filter(t => !INSURANCE_ONLY_DISPUTE_TYPES.includes(t))
}

export async function getPlaybookForPortfolio(params: {
  company_id: string
  portfolio_id: string | null
  category: PortfolioCategory | null
}): Promise<Playbook> {
  const category = params.category ?? 'other'
  const fallback = CATEGORY_DEFAULTS[category] ?? CATEGORY_DEFAULTS.other

  if (!params.portfolio_id) {
    return {
      portfolio_id: '',
      category,
      discounts: { allowed: false, max_percent: 0, requires_admin_approval: true },
      installments: { allowed: false, max_months: 0, requires_admin_approval: true },
      fields_to_surface: fallback.fields_to_surface,
      allowed_dispute_types: sanitizeDisputeTypes(fallback.allowed_dispute_types, category),
      notes: null,
      is_default: true,
    }
  }

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('company_playbooks')
    .select('*')
    .eq('company_id', params.company_id)
    .eq('portfolio_id', params.portfolio_id)
    .eq('is_active', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) {
    return {
      portfolio_id: params.portfolio_id,
      category,
      discounts: { allowed: false, max_percent: 0, requires_admin_approval: true },
      installments: { allowed: false, max_months: 0, requires_admin_approval: true },
      fields_to_surface: fallback.fields_to_surface,
      allowed_dispute_types: sanitizeDisputeTypes(fallback.allowed_dispute_types, category),
      notes: null,
      is_default: true,
    }
  }

  return {
    portfolio_id: params.portfolio_id,
    category,
    discounts: data.discounts ?? { allowed: false, max_percent: 0, requires_admin_approval: true },
    installments: data.installments ?? { allowed: false, max_months: 0, requires_admin_approval: true },
    fields_to_surface: Array.isArray(data.fields_to_surface) && data.fields_to_surface.length
      ? data.fields_to_surface
      : fallback.fields_to_surface,
    allowed_dispute_types: sanitizeDisputeTypes(
      Array.isArray(data.allowed_dispute_types) && data.allowed_dispute_types.length
        ? data.allowed_dispute_types
        : fallback.allowed_dispute_types,
      category
    ),
    notes: data.notes ?? null,
    is_default: false,
  }
}

// Renders the playbook as a short policy block injected into the system
// prompt — text only; every limit it states (discount %, installment
// months, never-auto-approve) is ALSO enforced as a deterministic guard in
// ai-collector-agent.ts, never relied on as a prompt instruction alone.
export function renderPlaybookForPrompt(pb: Playbook): string {
  const lines: string[] = []
  lines.push(`- القطاع: ${pb.category}${pb.is_default ? ' (سياسة افتراضية للقطاع — لا توجد سياسة مخصصة محفوظة لهذي المحفظة بعد)' : ''}`)
  lines.push(`- المواضيع المسموح الحديث عنها لهذي الشركة بالذات: ${pb.fields_to_surface.join('، ') || 'غير محدد'}`)
  lines.push(`- أنواع الاعتراض المعتمدة لهذا القطاع: ${pb.allowed_dispute_types.join('، ') || 'غير محدد'}`)
  if (pb.discounts.allowed) {
    lines.push(`- 🔴 الخصم: مسموح كسياسة بحد أقصى ${pb.discounts.max_percent}%، لكن أي خصم فعلي يحتاج موافقة إدارة دائماً — لا توافق بنفسك مهما كان.`)
  } else {
    lines.push('- 🔴 الخصم: غير مسموح بهذي المحفظة إطلاقاً، لا تعرضه ولا توافق عليه.')
  }
  if (pb.installments.allowed) {
    lines.push(`- 🔴 التقسيط: مسموح كسياسة بحد أقصى ${pb.installments.max_months} شهر، لكن أي تقسيط فعلي يحتاج موافقة إدارة دائماً — ارفع طلباً فقط، لا توافق بنفسك.`)
  } else {
    lines.push('- 🔴 التقسيط: غير مسموح بهذي المحفظة إطلاقاً.')
  }
  if (pb.category !== 'insurance') {
    lines.push('- 🔴🔴 ممنوع منعاً باتاً ذكر "حق رجوع" أو "طرف ثالث" أو "حذف مسترد" — هذي مفاهيم تأمين فقط ولا تخص هذي الشركة.')
  }
  if (pb.notes) lines.push(`- ملاحظة سياسة: ${pb.notes}`)
  return lines.join('\n')
}
