export function mapImportedStatus(input?: string | null) {
  const raw = String(input ?? '').trim().toLowerCase()

  if (!raw) return 'active'

  if (
    raw.includes('paid full') ||
    raw.includes('full paid') ||
    raw.includes('settled') ||
    raw.includes('تم السداد') ||
    raw.includes('سدد كامل') ||
    raw.includes('سداد كامل')
  ) return 'settled'

  if (
    raw.includes('partial') ||
    raw.includes('سداد جزئي') ||
    raw.includes('جزئي')
  ) return 'payment_plan'

  if (
    raw.includes('promise') ||
    raw.includes('وعد') ||
    raw.includes('بسدد')
  ) return 'in_negotiation'

  if (
    raw.includes('refused') ||
    raw.includes('رفض') ||
    raw.includes('رافض')
  ) return 'in_negotiation'

  if (
    raw.includes('wrong number') ||
    raw.includes('not customer') ||
    raw.includes('لا يخص العميل') ||
    raw.includes('رقم خطأ')
  ) return 'pending'

  if (
    raw.includes('legal') ||
    raw.includes('قانون')
  ) return 'legal'

  if (
    raw.includes('written') ||
    raw.includes('closed') ||
    raw.includes('مغلق')
  ) return 'written_off'

  if (
    raw.includes('tenant') ||
    raw.includes('مستأجر') ||
    raw.includes('license') ||
    raw.includes('رخصة') ||
    raw.includes('وثيقة') ||
    raw.includes('dispute') ||
    raw.includes('اعتراض')
  ) return 'pending'

  return 'active'
}

export function calculateImportRisk(status?: string | null, amount?: number) {
  const s = mapImportedStatus(status)

  if (s === 'settled') return 'low'
  if (s === 'legal' || Number(amount ?? 0) >= 8000) return 'high'
  if (s === 'in_negotiation' || s === 'pending') return 'medium'

  return 'medium'
}
