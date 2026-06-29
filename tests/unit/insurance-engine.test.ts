import { describe, it, expect } from 'vitest'
import { classifyInsuranceCase } from '@/lib/insurance-engine'

describe('classifyInsuranceCase', () => {
  it('returns null claim_type with no accident data at all (never guesses)', () => {
    const c = classifyInsuranceCase(null)
    expect(c.claim_type).toBeNull()
  })

  it('classifies recourse when recourse_reason is present (Tawuniya shape)', () => {
    const c = classifyInsuranceCase({ recourse_reason: 'تجاوز إشارة حمراء', recovery_number: 'R-123' })
    expect(c.claim_type).toBe('recourse')
    expect(c.recovery_number).toBe('R-123')
  })

  it('classifies third_party when accident data exists but no recourse reason', () => {
    const c = classifyInsuranceCase({ accident_city: 'الرياض', plate_number: 'ABC123' })
    expect(c.claim_type).toBe('third_party')
  })

  // Regression: MidGulf's real imported column is named accident_number
  // (see portfolio-data-fields.ts midgulf.fields), not recovery_number like
  // Tawuniya — without a fallback, recovery_number was always null and the
  // claim reference number silently never appeared for any MidGulf customer.
  it('falls back to accident_number for the claim reference (MidGulf shape)', () => {
    const c = classifyInsuranceCase({ accident_number: 'AC-9988', accident_city: 'جدة', recourse_reason: 'رخصة منتهية' })
    expect(c.recovery_number).toBe('AC-9988')
    expect(c.claim_type).toBe('recourse')
  })

  it('prefers recovery_number over accident_number when both somehow exist', () => {
    const c = classifyInsuranceCase({ recovery_number: 'R-1', accident_number: 'AC-2' })
    expect(c.recovery_number).toBe('R-1')
  })
})
