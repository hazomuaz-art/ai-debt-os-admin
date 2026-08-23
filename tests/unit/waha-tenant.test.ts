import { describe, expect, it } from 'vitest'
import { buildTenantPhoneFilter, resolveWahaSessionCompany } from '@/lib/waha-tenant'

describe('WAHA tenant isolation helpers', () => {
  it('requires every phone match branch to include the company id', () => {
    const companyId = '00000000-0000-0000-0000-000000000001'
    const filter = buildTenantPhoneFilter(companyId, '966500000000')
    const branches = filter.split('),').map((branch, index, all) => index < all.length - 1 ? `${branch})` : branch)
    expect(branches).toHaveLength(4)
    for (const branch of branches) expect(branch).toContain(`company_id.eq.${companyId}`)
  })

  it('rejects malformed tenant ids and phone filters', () => {
    expect(() => buildTenantPhoneFilter('co-1', '966500000000')).toThrow(/company id/)
    expect(() => buildTenantPhoneFilter('00000000-0000-0000-0000-000000000001', '1)')).toThrow(/phone/)
  })

  it('uses the explicit session-to-company map when configured', async () => {
    process.env.WAHA_SESSION_COMPANY_MAP = JSON.stringify({ default: '00000000-0000-0000-0000-000000000001' })
    await expect(resolveWahaSessionCompany('default')).resolves.toBe('00000000-0000-0000-0000-000000000001')
  })
})
