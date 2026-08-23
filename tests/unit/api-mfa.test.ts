import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const state = vi.hoisted(() => ({
  role: 'admin' as 'admin' | 'manager' | 'collector',
  level: 'aal1' as 'aal1' | 'aal2',
  assuranceError: null as { message: string } | null,
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1', email: 'a@example.com' } }, error: null })),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({
          data: { currentLevel: state.level, nextLevel: 'aal2' },
          error: state.assuranceError,
        })),
      },
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: 'user-1', company_id: 'co-1', role: state.role, full_name: 'Admin', is_active: true },
            error: null,
          })),
        })),
      })),
    })),
  })),
  createServiceClient: vi.fn(() => ({})),
}))

import { withAuth } from '@/lib/api'

describe('withAuth privileged MFA enforcement', () => {
  beforeEach(() => {
    state.role = 'admin'
    state.level = 'aal1'
    state.assuranceError = null
  })

  it('rejects an admin API request at AAL1', async () => {
    const response = await withAuth(async () => NextResponse.json({ ok: true }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: 'Multi-factor authentication is required' })
  })

  it('accepts an admin API request at AAL2', async () => {
    state.level = 'aal2'
    const response = await withAuth(async () => NextResponse.json({ ok: true }))
    expect(response.status).toBe(200)
  })

  it('fails closed when assurance cannot be read', async () => {
    state.level = 'aal2'
    state.assuranceError = { message: 'temporary failure' }
    const response = await withAuth(async () => NextResponse.json({ ok: true }))
    expect(response.status).toBe(403)
  })

  it('does not force MFA for collector APIs by default', async () => {
    state.role = 'collector'
    const response = await withAuth(async () => NextResponse.json({ ok: true }))
    expect(response.status).toBe(200)
  })
})
