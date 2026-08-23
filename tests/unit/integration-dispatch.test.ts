import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/safe-fetch', () => ({ safeIntegrationFetch: vi.fn() }))

import { safeIntegrationFetch } from '@/lib/safe-fetch'
import { testIntegrationConnection } from '@/lib/integrations'

describe('integration connectivity dispatch', () => {
  beforeEach(() => vi.mocked(safeIntegrationFetch).mockReset())

  it('routes n8n to its health check rather than the collection API adapter', async () => {
    vi.mocked(safeIntegrationFetch).mockResolvedValue(new Response(null, { status: 200 }))

    const result = await testIntegrationConnection('n8n_automation', {
      webhook_url: 'https://automation.example.com/webhook/collections',
      auth_token: 'test-token',
    })

    expect(result.success).toBe(true)
    expect(safeIntegrationFetch).toHaveBeenCalledWith(
      'https://automation.example.com/healthz',
      expect.objectContaining({ method: 'GET' }),
      8000,
    )
  })
})
