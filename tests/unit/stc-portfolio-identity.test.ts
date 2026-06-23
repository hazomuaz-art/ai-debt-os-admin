import { describe, it, expect } from 'vitest'
import { COMPANY_IMPORT_PROFILES } from '@/lib/company-import-profiles'

// The real STC portfolio row in the DB is named "إس تي سي" (Arabic), not the
// Latin "STC". ai-collector-agent.ts gates its STC-only legal-suppression
// logic on this same alias list — if the alias list ever loses the Arabic
// name, that gate silently stops matching the real production portfolio.
describe('STC portfolio identity — must match the real DB portfolio name', () => {
  const stcProfile = COMPANY_IMPORT_PROFILES.find(p => p.key === 'stc')

  it('has an STC profile', () => {
    expect(stcProfile).toBeTruthy()
  })

  it('aliases include the real DB portfolio name "إس تي سي"', () => {
    expect(stcProfile?.aliases).toContain('إس تي سي')
  })

  it('aliases include the Latin "stc" too', () => {
    expect(stcProfile?.aliases).toContain('stc')
  })

  it('other portfolios (Mobily) are a distinct profile, never matched as STC', () => {
    const mobily = COMPANY_IMPORT_PROFILES.find(p => p.key === 'mobily')
    expect(mobily?.aliases).not.toContain('إس تي سي')
    expect(stcProfile?.aliases).not.toContain('موبايلي')
  })
})
