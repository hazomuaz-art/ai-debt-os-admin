import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Rasf inbound tenant isolation', () => {
  it('requires an explicit tenant map and scopes customer and debt queries', () => {
    const source = readFileSync(resolve('src/app/api/rasf/webhook/route.ts'), 'utf8')

    expect(source).toContain("resolveCompanyFromEnvMap('RASF_WEBHOOK_COMPANY_MAP'")
    expect(source).toContain(".from('customers')")
    expect(source).toContain(".eq('company_id', companyId)")
    expect(source).toContain(".from('debts')")
  })
})
