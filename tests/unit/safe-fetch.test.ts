import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { isPrivateAddress, validateIntegrationUrl } from '@/lib/safe-fetch'

describe('safe integration fetch URL validation', () => {
  const resolvePublic = async () => [{ address: '93.184.216.34' }]
  const resolvePrivate = async () => [{ address: '127.0.0.1' }]
  const originalNodeEnv = process.env.NODE_ENV
  const originalHosts = process.env.INTEGRATION_ALLOWED_HOSTS

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('INTEGRATION_ALLOWED_HOSTS', 'api.example.com')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env.NODE_ENV = originalNodeEnv
    process.env.INTEGRATION_ALLOWED_HOSTS = originalHosts
  })

  it.each(['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.2', '::1', 'fd00::1'])(
    'classifies %s as private/reserved',
    address => expect(isPrivateAddress(address)).toBe(true),
  )

  it('accepts an allowlisted public HTTPS host', async () => {
    await expect(validateIntegrationUrl('https://api.example.com/status', resolvePublic)).resolves.toBeInstanceOf(URL)
  })

  it('blocks private DNS results even when the hostname is allowlisted', async () => {
    vi.stubEnv('INTEGRATION_ALLOWED_HOSTS', 'internal.example')
    await expect(validateIntegrationUrl('https://internal.example/admin', resolvePrivate)).rejects.toThrow(/private or reserved/)
  })

  it('blocks non-allowlisted hosts and non-HTTPS URLs', async () => {
    await expect(validateIntegrationUrl('https://evil.example/', resolvePublic)).rejects.toThrow(/INTEGRATION_ALLOWED_HOSTS/)
    await expect(validateIntegrationUrl('http://api.example.com/', resolvePublic)).rejects.toThrow(/HTTPS/)
  })
})
