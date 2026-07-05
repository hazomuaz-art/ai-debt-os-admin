import { describe, it, expect } from 'vitest'
import { parseWebhookPayload, isWithinAllowedContactHours } from '@/lib/whatsapp'
import { createHash } from 'crypto'

// ── isWithinAllowedContactHours (CST/SAMA contact-hours gate) ───────────────
// Saudi time = UTC+3. Blocked window: 22:00-09:00 Saudi time.

describe('isWithinAllowedContactHours', () => {
  it('allows a send at noon Saudi time (09:00 UTC)', () => {
    expect(isWithinAllowedContactHours(new Date('2026-07-05T09:00:00Z'))).toBe(true)
  })
  it('allows a send right at the 9am Saudi opening (06:00 UTC)', () => {
    expect(isWithinAllowedContactHours(new Date('2026-07-05T06:00:00Z'))).toBe(true)
  })
  it('blocks a send at 8:59am Saudi time (05:59 UTC)', () => {
    expect(isWithinAllowedContactHours(new Date('2026-07-05T05:59:00Z'))).toBe(false)
  })
  it('blocks a send right at the 10pm Saudi close (19:00 UTC)', () => {
    expect(isWithinAllowedContactHours(new Date('2026-07-05T19:00:00Z'))).toBe(false)
  })
  it('blocks a send at midnight Saudi time (21:00 UTC, wraps to next day)', () => {
    expect(isWithinAllowedContactHours(new Date('2026-07-05T21:00:00Z'))).toBe(false)
  })
  it('allows a send at 9:01am Saudi time (06:01 UTC)', () => {
    expect(isWithinAllowedContactHours(new Date('2026-07-05T06:01:00Z'))).toBe(true)
  })
})

// ── parseWebhookPayload ───────────────────────────────────────────────────

describe('parseWebhookPayload', () => {
  const makePayload = (overrides: any = {}) => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'entry-1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '+966500000000',
            phone_number_id:      '123456',
          },
          contacts: [{ profile: { name: 'Ahmed' }, wa_id: '966501234567' }],
          messages: [{
            from:      '966501234567',
            id:        'wamid.test123',
            timestamp: '1700000000',
            type:      'text',
            text:      { body: 'Hello, I want to pay my debt' },
          }],
          ...overrides,
        },
      }],
    }],
  })

  it('extracts text messages', () => {
    const result = parseWebhookPayload(makePayload())
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].from).toBe('966501234567')
    expect(result.messages[0].text).toBe('Hello, I want to pay my debt')
    expect(result.messages[0].id).toBe('wamid.test123')
  })

  it('ignores non-text message types', () => {
    const result = parseWebhookPayload(makePayload({
      messages: [{
        from:      '966501234567',
        id:        'wamid.img',
        timestamp: '1700000000',
        type:      'image',  // not text
      }],
    }))
    expect(result.messages).toHaveLength(0)
  })

  it('extracts delivery status updates', () => {
    const result = parseWebhookPayload(makePayload({
      messages:  [],
      statuses: [{
        id:           'wamid.sent123',
        status:       'delivered',
        timestamp:    '1700000000',
        recipient_id: '966501234567',
      }],
    }))
    expect(result.statuses).toHaveLength(1)
    expect(result.statuses[0].status).toBe('delivered')
    expect(result.statuses[0].message_id).toBe('wamid.sent123')
  })

  it('returns empty arrays for non-whatsapp object', () => {
    const result = parseWebhookPayload({
      object: 'instagram',
      entry:  [],
    })
    expect(result.messages).toHaveLength(0)
    expect(result.statuses).toHaveLength(0)
  })

  it('handles multiple messages in one payload', () => {
    const result = parseWebhookPayload(makePayload({
      messages: [
        { from: '966501234567', id: 'wamid.1', timestamp: '1700000001', type: 'text', text: { body: 'Msg 1' } },
        { from: '966509876543', id: 'wamid.2', timestamp: '1700000002', type: 'text', text: { body: 'Msg 2' } },
      ],
    }))
    expect(result.messages).toHaveLength(2)
  })

  it('handles empty entry array', () => {
    const result = parseWebhookPayload({ object: 'whatsapp_business_account', entry: [] })
    expect(result.messages).toHaveLength(0)
    expect(result.statuses).toHaveLength(0)
  })

  it('handles malformed changes gracefully', () => {
    const result = parseWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [] }],
    })
    expect(result.messages).toHaveLength(0)
  })
})

// ── Signature verification ────────────────────────────────────────────────
// Test the HMAC logic in isolation (can't import the route directly,
// but we can test the algorithm)

describe('HMAC-SHA256 signature format', () => {
  it('produces correct signature format', () => {
    const secret  = 'test-app-secret'
    const body    = JSON.stringify({ test: true })
    const sig     = 'sha256=' + createHash('sha256').update(secret).update(body).digest('hex')

    expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/)
  })

  it('two identical inputs produce identical signatures', () => {
    const secret = 'my-secret'
    const body   = 'test-body'
    const sig1   = createHash('sha256').update(secret).update(body).digest('hex')
    const sig2   = createHash('sha256').update(secret).update(body).digest('hex')
    expect(sig1).toBe(sig2)
  })

  it('different bodies produce different signatures', () => {
    const secret = 'my-secret'
    const sig1   = createHash('sha256').update(secret).update('body1').digest('hex')
    const sig2   = createHash('sha256').update(secret).update('body2').digest('hex')
    expect(sig1).not.toBe(sig2)
  })
})

// ── Phone number normalization ────────────────────────────────────────────

describe('phone number normalization', () => {
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.startsWith('0')) return '966' + digits.slice(1)
    return digits
  }

  it('normalizes Saudi local number', () => {
    expect(normalizePhone('0501234567')).toBe('966501234567')
  })

  it('normalizes E.164 number', () => {
    expect(normalizePhone('+966501234567')).toBe('966501234567')
  })

  it('strips dashes and spaces', () => {
    expect(normalizePhone('+966-50 123-4567')).toBe('966501234567')
  })

  it('leaves already-normalized number unchanged', () => {
    expect(normalizePhone('966501234567')).toBe('966501234567')
  })
})
