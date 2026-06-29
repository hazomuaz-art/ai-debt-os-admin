import { describe, it, expect, beforeEach } from 'vitest'
import { sendEmail } from '@/lib/email'

describe('sendEmail — infrastructure-only skeleton (no real provider wired yet)', () => {
  beforeEach(() => {
    delete process.env.EMAIL_PROVIDER
    delete process.env.EMAIL_API_KEY
    delete process.env.EMAIL_FROM_ADDRESS
  })

  it('never throws and returns a clear failure when no provider is configured', async () => {
    const result = await sendEmail({ to: 'customer@example.com', subject: 'test', body: 'hello' })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('email_provider_not_configured')
    expect(result.message_id).toBeNull()
  })

  it('reports a distinct, more specific error once env vars are set but the actual provider call is not yet implemented', async () => {
    process.env.EMAIL_PROVIDER = 'postmark'
    process.env.EMAIL_API_KEY = 'test-key'
    process.env.EMAIL_FROM_ADDRESS = 'collections@example.com'
    const result = await sendEmail({ to: 'customer@example.com', subject: 'test', body: 'hello' })
    expect(result.status).toBe('failed')
    expect(result.error).toBe('email_provider_not_implemented')
  })
})
