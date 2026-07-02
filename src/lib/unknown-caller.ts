import { createServiceClient } from '@/lib/supabase/server'
import { createLogger } from '@/lib/logger'
import { insertSystemAlert } from '@/lib/system-alerts'

const log = createLogger('unknown-caller')

const MAX_ATTEMPTS = 3

// A phone number matching no customer record used to be a dead end: log a
// warning, raise a platform-wide alert, never reply. Real gap the user
// explicitly asked to fix: a genuine customer messaging from a NEW/different
// number (not yet on file) got silently ignored forever. This module lets
// the agent ask for something identifying (national ID / account number /
// invoice-reference number — same fields a real human collector would ask
// for), search for an EXACT match, and only ever disclose debt details once
// exactly one customer matches. Deliberately does NOT reintroduce the old
// last-4-digit verification lock (removed earlier as too much friction) —
// an exact match on one of these fields is the bar, consistent with how
// this product already treats a known customer as sufficiently identified.
function extractCandidates(text: string): string[] {
  const ascii = String(text ?? '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
  const matches = ascii.match(/\d{6,15}/g) ?? []
  return Array.from(new Set(matches))
}

type MatchResult = {
  customer_id: string
  company_id: string
  debt_id: string | null
}

async function findUniqueMatch(
  supabase: ReturnType<typeof createServiceClient>,
  candidates: string[],
): Promise<MatchResult | 'ambiguous' | null> {
  if (!candidates.length) return null

  const foundCustomerIds = new Set<string>()
  let matchedCustomerId: string | null = null

  const { data: byNationalId } = await supabase
    .from('customers').select('id').in('national_id', candidates)
  for (const row of (byNationalId ?? []) as { id: string }[]) foundCustomerIds.add(row.id)

  const { data: byAccountOrRef } = await supabase
    .from('debts').select('customer_id')
    .or(candidates.map(c => `account_number.eq.${c},reference_number.eq.${c}`).join(','))
  for (const row of (byAccountOrRef ?? []) as { customer_id: string }[]) foundCustomerIds.add(row.customer_id)

  if (foundCustomerIds.size === 0) return null
  if (foundCustomerIds.size > 1) return 'ambiguous'
  matchedCustomerId = Array.from(foundCustomerIds)[0]

  const { data: customer } = await supabase
    .from('customers').select('id, company_id').eq('id', matchedCustomerId).maybeSingle()
  if (!customer) return null

  const { data: debt } = await supabase
    .from('debts').select('id').eq('customer_id', matchedCustomerId)
    .not('status', 'in', '("settled","written_off")')
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  return {
    customer_id: (customer as { id: string; company_id: string }).id,
    company_id: (customer as { id: string; company_id: string }).company_id,
    debt_id: (debt as { id: string } | null)?.id ?? null,
  }
}

export async function handleUnknownCaller(args: {
  phone: string
  message: string
}): Promise<{ reply: string | null; matched: MatchResult | null }> {
  const supabase = createServiceClient()

  const { data: existing } = await supabase
    .from('unmatched_contacts').select('*').eq('phone', args.phone).maybeSingle()

  const candidates = extractCandidates(args.message)
  const isFirstContact = !existing

  if (isFirstContact) {
    const { error: insertErr } = await supabase.from('unmatched_contacts').insert({
      phone: args.phone, attempts_count: candidates.length ? 1 : 0,
      last_message: args.message, status: 'pending',
    })
    if (insertErr) log.error('failed to create unmatched_contacts row', insertErr, { phone: args.phone })
  }

  if (!candidates.length) {
    if (isFirstContact) {
      return {
        matched: null,
        reply: 'مرحباً، هذا النظام الآلي للتحصيل. رقمك غير مسجّل عندنا حالياً — ممكن ترسل لي رقم الهوية أو رقم الحساب أو رقم الفاتورة/المطالبة عشان أقدر أوصل لبياناتك؟',
      }
    }
    return { matched: null, reply: null }
  }

  const match = await findUniqueMatch(supabase, candidates)

  if (match === null || match === 'ambiguous') {
    const attempts = (existing?.attempts_count ?? 0) + 1
    const gaveUp = attempts >= MAX_ATTEMPTS
    const { error: updErr } = await supabase.from('unmatched_contacts').update({
      attempts_count: attempts, last_message: args.message,
      status: gaveUp ? 'given_up' : 'pending', updated_at: new Date().toISOString(),
    }).eq('phone', args.phone)
    if (updErr) log.error('failed to update unmatched_contacts attempt count', updErr, { phone: args.phone })

    if (gaveUp) {
      await insertSystemAlert({
        company_id: null, severity: 'warning', alert_type: 'unmatched_contact_gave_up',
        title: 'عميل لم يُتعرّف عليه بعد عدة محاولات',
        message: `الرقم ${args.phone} حاول عدة مرات إثبات هويته (${candidates.join(', ')}) بدون تطابق مؤكد في النظام — راجعه يدوياً.`,
        metadata: { phone: args.phone, candidates },
      })
      return {
        matched: null,
        reply: 'ما قدرت أوصل لبياناتك بالمعلومات اللي وصلتني. راح يتواصل معك أحد من فريقنا للمساعدة.',
      }
    }
    return {
      matched: null,
      reply: 'ما لقيت تطابق بهذي البيانات. تأكد من الرقم وأرسله مرة ثانية (رقم الهوية أو رقم الحساب أو رقم الفاتورة/المطالبة).',
    }
  }

  // Exactly one match — link this new number as a secondary contact (never
  // overwrites the customer's existing primary phone/whatsapp) so future
  // inbound messages from this same number resolve immediately without
  // repeating this flow, then let the normal collector agent take over for
  // the actual reply so the conversation continues naturally from here.
  const { error: linkErr } = await supabase.from('customer_contacts').insert({
    company_id: match.company_id, customer_id: match.customer_id, phone: args.phone,
    is_primary: false, status: 'delivered', source: 'inbound_self_identified',
  })
  if (linkErr) log.error('failed to link new number as secondary contact', linkErr, { phone: args.phone, customer_id: match.customer_id })

  const { error: resolveErr } = await supabase.from('unmatched_contacts').update({
    status: 'resolved', matched_customer_id: match.customer_id, matched_debt_id: match.debt_id,
    updated_at: new Date().toISOString(),
  }).eq('phone', args.phone)
  if (resolveErr) log.error('failed to mark unmatched_contacts resolved', resolveErr, { phone: args.phone })

  return { matched: match, reply: null }
}
