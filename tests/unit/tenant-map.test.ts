import { afterEach, describe, expect, it } from 'vitest'
import { isCompanyUuid, resolveCompanyFromEnvMap } from '@/lib/tenant-map'

const ENV_NAME = 'TEST_TENANT_COMPANY_MAP'
const COMPANY_ID = '123e4567-e89b-42d3-a456-426614174000'

describe('tenant environment maps', () => {
  afterEach(() => delete process.env[ENV_NAME])

  it('resolves a routing key to a validated company UUID', () => {
    process.env[ENV_NAME] = JSON.stringify({ primary: COMPANY_ID })
    expect(resolveCompanyFromEnvMap(ENV_NAME, 'primary')).toBe(COMPANY_ID)
    expect(isCompanyUuid(COMPANY_ID)).toBe(true)
  })

  it('returns null for an unmapped key', () => {
    process.env[ENV_NAME] = JSON.stringify({ primary: COMPANY_ID })
    expect(resolveCompanyFromEnvMap(ENV_NAME, 'missing')).toBeNull()
  })

  it('rejects malformed maps and invalid company identifiers', () => {
    process.env[ENV_NAME] = '{broken'
    expect(() => resolveCompanyFromEnvMap(ENV_NAME, 'primary')).toThrow('valid JSON object')

    process.env[ENV_NAME] = JSON.stringify({ primary: 'not-a-uuid' })
    expect(() => resolveCompanyFromEnvMap(ENV_NAME, 'primary')).toThrow('company UUID')
  })
})
