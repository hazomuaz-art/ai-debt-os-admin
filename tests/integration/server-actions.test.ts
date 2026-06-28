import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabaseClient, fixtures } from '../setup'

// These tests exercise the server actions with mocked Supabase

describe('createCustomerAction', () => {
  let mockClient: ReturnType<typeof mockSupabaseClient>

  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = mockSupabaseClient()
  })

  it('returns error for unauthenticated user', async () => {
    // Mock getUser returning null
    mockClient.auth.getUser.mockResolvedValue({ data: { user: null }, error: null })
    vi.mocked((await import('@/lib/supabase/server')).createClient).mockReturnValue(mockClient)

    const { createCustomerAction } = await import('@/lib/actions/debts')
    const formData = new FormData()
    formData.set('full_name', 'Test User')

    const result = await createCustomerAction(formData)
    expect(result.error).toBeTruthy()
  })

  it('validates full_name minimum length', async () => {
    // Set up authenticated user
    mockClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'admin@test.com' } },
      error: null,
    })
    mockClient.single.mockResolvedValue({ data: fixtures.adminProfile, error: null })
    vi.mocked((await import('@/lib/supabase/server')).createClient).mockReturnValue(mockClient)

    const { createCustomerAction } = await import('@/lib/actions/debts')
    const formData = new FormData()
    formData.set('full_name', 'A')  // too short

    const result = await createCustomerAction(formData)
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/min|String must contain|least/i)
  })
})

describe('recordPaymentAction', () => {
  it('prevents paying more than current balance', async () => {
    const mockClient = mockSupabaseClient()
    mockClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'admin@test.com' } },
      error: null,
    })
    // Profile lookup
    mockClient.single
      .mockResolvedValueOnce({ data: fixtures.adminProfile, error: null })
      // Debt lookup
      .mockResolvedValueOnce({ data: fixtures.debt, error: null })

    vi.mocked((await import('@/lib/supabase/server')).createClient).mockReturnValue(mockClient)

    const { recordPaymentAction } = await import('@/lib/actions/debts')

    const result = await recordPaymentAction({
      debt_id: fixtures.debt.id,
      amount:  999999,  // way more than 45000 balance
    })
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/balance|exceed/i)
  })

  it('prevents recording payment on settled debt', async () => {
    const mockClient = mockSupabaseClient()
    mockClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'admin@test.com' } },
      error: null,
    })
    mockClient.single
      .mockResolvedValueOnce({ data: fixtures.adminProfile, error: null })
      .mockResolvedValueOnce({ data: { ...fixtures.debt, status: 'settled' }, error: null })

    vi.mocked((await import('@/lib/supabase/server')).createClient).mockReturnValue(mockClient)

    const { recordPaymentAction } = await import('@/lib/actions/debts')

    const result = await recordPaymentAction({
      debt_id: fixtures.debt.id,
      amount:  1000,
    })
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/settled/i)
  })

  it('rejects zero or negative amount', async () => {
    const { recordPaymentAction } = await import('@/lib/actions/debts')

    const result = await recordPaymentAction({
      debt_id: fixtures.debt.id,
      amount:  0,
    })
    expect(result.error).toBeTruthy()
  })
})

describe('updateDebtStatusAction', () => {
  it('rejects invalid status values', async () => {
    const mockClient = mockSupabaseClient()
    mockClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'admin@test.com' } },
      error: null,
    })
    mockClient.single.mockResolvedValue({ data: fixtures.adminProfile, error: null })
    vi.mocked((await import('@/lib/supabase/server')).createClient).mockReturnValue(mockClient)

    const { updateDebtStatusAction } = await import('@/lib/actions/debts')

    const result = await updateDebtStatusAction('debt-id', 'hacked_status' as any)
    expect(result.error).toBeTruthy()
  })

  it('prevents non-admin from unsettling a debt', async () => {
    const mockClient = mockSupabaseClient()
    mockClient.auth.getUser.mockResolvedValue({
      data: { user: { id: 'collector-456', email: 'collector@test.com' } },
      error: null,
    })
    mockClient.single
      .mockResolvedValueOnce({ data: fixtures.collectorProfile, error: null })
      .mockResolvedValueOnce({ data: { ...fixtures.debt, status: 'settled' }, error: null })

    vi.mocked((await import('@/lib/supabase/server')).createClient).mockReturnValue(mockClient)

    const { updateDebtStatusAction } = await import('@/lib/actions/debts')

    const result = await updateDebtStatusAction('debt-id', 'active')
    expect(result.error).toBeTruthy()
    expect(result.error).toMatch(/admin/i)
  })
})
