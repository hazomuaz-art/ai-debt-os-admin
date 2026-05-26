import { describe, it, expect, vi } from 'vitest'
import {
  errors,
  parseBody,
  parseQuery,
  paginationSchema,
  scoreDebtSchema,
  sendWhatsAppSchema,
  recordPaymentSchema,
  createCustomerSchema,
  inviteUserSchema,
  phoneSchema,
} from '@/lib/api'
import { z } from 'zod'

// ── errors factory ────────────────────────────────────────────────────────

describe('errors factory', () => {
  it('unauthorized returns 401', async () => {
    const res = errors.unauthorized()
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('forbidden returns 403', async () => {
    const res = errors.forbidden()
    expect(res.status).toBe(403)
  })

  it('notFound returns 404 with entity name', async () => {
    const res = errors.notFound('Debt')
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain('Debt')
  })

  it('rateLimited returns 429', async () => {
    const res = errors.rateLimited()
    expect(res.status).toBe(429)
  })

  it('internal returns 500', async () => {
    const res = errors.internal()
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('INTERNAL_ERROR')
  })

  it('conflict returns 409', async () => {
    const res = errors.conflict('Already exists')
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('Already exists')
  })

  it('validation formats zod errors into per-field details', async () => {
    const schema = z.object({ name: z.string().min(2), age: z.number() })
    const result = schema.safeParse({ name: 'a', age: 'not-a-number' })
    expect(result.success).toBe(false)
    if (!result.success) {
      const res = errors.validation(result.error)
      expect(res.status).toBe(422)
      const body = await res.json()
      expect(body.code).toBe('VALIDATION_ERROR')
      expect(body.details).toBeDefined()
      expect(body.details!['name']).toBeDefined()
    }
  })
})

// ── parseBody ─────────────────────────────────────────────────────────────

describe('parseBody', () => {
  function makeRequest(body: unknown) {
    return new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('parses valid body', async () => {
    const schema = z.object({ debt_id: z.string().uuid() })
    const req = makeRequest({ debt_id: '550e8400-e29b-41d4-a716-446655440000' })
    const result = await parseBody(req, schema)
    expect(result.error).toBeNull()
    expect(result.data?.debt_id).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('returns error for invalid JSON', async () => {
    const schema = z.object({ field: z.string() })
    const req = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json {{{',
    })
    const result = await parseBody(req, schema)
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect((await result.error!.json()).code).toBe('BAD_REQUEST')
  })

  it('returns validation error for schema mismatch', async () => {
    const schema = z.object({ amount: z.number().positive() })
    const req = makeRequest({ amount: -100 })
    const result = await parseBody(req, schema)
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
    expect((await result.error!.json()).code).toBe('VALIDATION_ERROR')
  })
})

// ── parseQuery ────────────────────────────────────────────────────────────

describe('parseQuery', () => {
  it('parses pagination defaults', () => {
    const params = new URLSearchParams()
    const result = parseQuery(params, paginationSchema)
    expect(result.error).toBeNull()
    expect(result.data?.page).toBe(1)
    expect(result.data?.limit).toBe(20)
  })

  it('parses custom pagination', () => {
    const params = new URLSearchParams({ page: '3', limit: '50' })
    const result = parseQuery(params, paginationSchema)
    expect(result.error).toBeNull()
    expect(result.data?.page).toBe(3)
    expect(result.data?.limit).toBe(50)
  })

  it('rejects limit > 100', () => {
    const params = new URLSearchParams({ limit: '999' })
    const result = parseQuery(params, paginationSchema)
    expect(result.data).toBeNull()
    expect(result.error).not.toBeNull()
  })
})

// ── Zod schemas ───────────────────────────────────────────────────────────

describe('scoreDebtSchema', () => {
  it('accepts valid UUID', () => {
    const result = scoreDebtSchema.safeParse({ debt_id: '550e8400-e29b-41d4-a716-446655440000' })
    expect(result.success).toBe(true)
  })

  it('rejects non-UUID', () => {
    const result = scoreDebtSchema.safeParse({ debt_id: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })
})

describe('phoneSchema', () => {
  it('accepts E.164 format', () => {
    const result = phoneSchema.safeParse('+966501234567')
    expect(result.success).toBe(true)
  })

  it('accepts local format', () => {
    const result = phoneSchema.safeParse('0501234567')
    expect(result.success).toBe(true)
  })

  it('rejects too-short numbers', () => {
    const result = phoneSchema.safeParse('123')
    expect(result.success).toBe(false)
  })

  it('strips formatting characters', () => {
    const result = phoneSchema.safeParse('+966 50 123 4567')
    expect(result.success).toBe(true)
    expect(result.data).toBe('+966501234567')
  })
})

describe('sendWhatsAppSchema', () => {
  it('accepts valid message', () => {
    const result = sendWhatsAppSchema.safeParse({
      phone:   '+966501234567',
      message: 'Hello, this is a test message',
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty message', () => {
    const result = sendWhatsAppSchema.safeParse({
      phone:   '+966501234567',
      message: '',
    })
    expect(result.success).toBe(false)
  })

  it('rejects message over 4096 chars', () => {
    const result = sendWhatsAppSchema.safeParse({
      phone:   '+966501234567',
      message: 'a'.repeat(4097),
    })
    expect(result.success).toBe(false)
  })
})

describe('recordPaymentSchema', () => {
  const validPayload = {
    debt_id:      '550e8400-e29b-41d4-a716-446655440000',
    amount:       5000,
    payment_date: '2024-03-15',
  }

  it('accepts minimal valid payment', () => {
    const result = recordPaymentSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('rejects negative amount', () => {
    const result = recordPaymentSchema.safeParse({ ...validPayload, amount: -100 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid date format', () => {
    const result = recordPaymentSchema.safeParse({ ...validPayload, payment_date: '15/03/2024' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid payment method', () => {
    const result = recordPaymentSchema.safeParse({ ...validPayload, payment_method: 'bitcoin' })
    expect(result.success).toBe(false)
  })
})

describe('inviteUserSchema', () => {
  const validPayload = {
    email:      'newuser@company.com',
    full_name:  'New User',
    role:       'collector',
    password:   'SecurePass123!',
    company_id: '550e8400-e29b-41d4-a716-446655440000',
  }

  it('accepts valid invite', () => {
    const result = inviteUserSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('rejects short password', () => {
    const result = inviteUserSchema.safeParse({ ...validPayload, password: 'short' })
    expect(result.success).toBe(false)
  })

  it('rejects invalid email', () => {
    const result = inviteUserSchema.safeParse({ ...validPayload, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('rejects admin role (not invitable via API)', () => {
    const result = inviteUserSchema.safeParse({ ...validPayload, role: 'admin' })
    expect(result.success).toBe(false)
  })
})
