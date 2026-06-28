import { describe, it, expect } from 'vitest'
import { COMPANY_IMPORT_PROFILES, type DebtStatus } from '@/lib/company-import-profiles'

const VALID_STATUSES: DebtStatus[] = [
  'active', 'in_progress', 'promised', 'partial', 'in_negotiation',
  'payment_plan', 'settled', 'written_off', 'legal', 'disputed',
]

describe('company outcome category metadata completeness', () => {
  it('every company profile has a non-empty outcomeCategories list', () => {
    for (const profile of COMPANY_IMPORT_PROFILES) {
      expect(profile.outcomeCategories.length, `${profile.key} has no outcomeCategories`).toBeGreaterThan(0)
    }
  })

  it('every outcome category has a matching outcomeMeta entry', () => {
    for (const profile of COMPANY_IMPORT_PROFILES) {
      for (const category of profile.outcomeCategories) {
        const meta = profile.outcomeMeta[category]
        expect(meta, `${profile.key}: missing outcomeMeta for "${category}"`).toBeTruthy()
      }
    }
  })

  it('every outcomeMeta entry has a valid status (or null) and non-empty meaning/behavior', () => {
    for (const profile of COMPANY_IMPORT_PROFILES) {
      for (const [category, meta] of Object.entries(profile.outcomeMeta)) {
        if (meta.status !== null) {
          expect(VALID_STATUSES, `${profile.key}/"${category}" has invalid status "${meta.status}"`).toContain(meta.status)
        }
        expect(meta.meaning.trim().length, `${profile.key}/"${category}" has empty meaning`).toBeGreaterThan(0)
        expect(meta.behavior.trim().length, `${profile.key}/"${category}" has empty behavior`).toBeGreaterThan(0)
        expect(typeof meta.isTerminal).toBe('boolean')
      }
    }
  })

  it('terminal categories (deceased/bankrupt/imprisoned) never carry an auto status guess', () => {
    for (const profile of COMPANY_IMPORT_PROFILES) {
      for (const [category, meta] of Object.entries(profile.outcomeMeta)) {
        if (meta.isTerminal) {
          expect(meta.status, `${profile.key}/"${category}" is terminal but has a guessed status`).toBeNull()
        }
      }
    }
  })
})
