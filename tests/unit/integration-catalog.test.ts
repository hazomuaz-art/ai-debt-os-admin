import { describe, expect, it } from 'vitest'
import {
  INTEGRATION_CATALOG,
  INTEGRATION_DEFINITIONS,
  INTEGRATION_NAMES,
} from '@/lib/integration-catalog'

describe('integration catalog', () => {
  it('derives names and UI definitions from the same registry', () => {
    expect(INTEGRATION_NAMES).toEqual(Object.keys(INTEGRATION_CATALOG))
    expect(INTEGRATION_DEFINITIONS.map(item => item.name)).toEqual(INTEGRATION_NAMES)
    expect(INTEGRATION_NAMES).toContain('n8n_automation')
  })

  it('marks only optional configuration fields as optional', () => {
    const optionalFields = INTEGRATION_DEFINITIONS.flatMap(integration =>
      integration.fields
        .filter(field => field.required === false)
        .map(field => `${integration.name}.${field.key}`),
    )
    expect(optionalFields).toEqual(['rasf_whatsapp.sender_id'])
  })
})
