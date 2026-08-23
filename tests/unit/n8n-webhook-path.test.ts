import { describe, expect, it } from 'vitest'
import { normalizeN8nWebhookPath } from '@/lib/n8n/client'

describe('n8n webhook path normalization', () => {
  it('normalizes known-safe relative paths', () => {
    expect(normalizeN8nWebhookPath('/campaigns/start/')).toBe('campaigns/start')
  })

  it('rejects traversal, URLs, and query strings', () => {
    expect(normalizeN8nWebhookPath('../healthz')).toBeNull()
    expect(normalizeN8nWebhookPath('https://attacker.example')).toBeNull()
    expect(normalizeN8nWebhookPath('workflow?admin=true')).toBeNull()
  })
})
