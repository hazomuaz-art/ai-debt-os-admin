import { vi, beforeAll, afterAll, afterEach } from 'vitest'

// ── Environment variables ──────────────────────────────────────────────────
// Set before any module is imported so env.ts validation passes
process.env.NEXT_PUBLIC_SUPABASE_URL     = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key-xxxxxxxxxxxxxxxxxxxx'
process.env.SUPABASE_SERVICE_ROLE_KEY    = 'test-service-role-key-xxxxxxxxxxxxxxxxx'
process.env.OPENROUTER_API_KEY           = 'sk-or-test-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
process.env.APP_SECRET                   = 'test-app-secret-32-characters-long!!'
process.env.NEXT_PUBLIC_APP_URL          = 'http://localhost:3000'
process.env.WHATSAPP_PHONE_NUMBER_ID     = '123456789'
process.env.WHATSAPP_ACCESS_TOKEN        = 'test-wa-token'
process.env.WHATSAPP_VERIFY_TOKEN        = 'test-verify-token'
process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = '987654321'
process.env.NODE_ENV                     = 'test'

// ── Supabase mock ──────────────────────────────────────────────────────────
// vi.fn() (not plain arrow functions) so individual tests can override the
// return value per-test via vi.mocked(createClient).mockReturnValue(...) —
// the default implementation still returns a working mock client for every
// test that doesn't need to override it.
vi.mock('@/lib/supabase/server', () => ({
  createClient:        vi.fn().mockImplementation(() => mockSupabaseClient()),
  createServerClient:  vi.fn().mockImplementation(() => mockSupabaseClient()),
  createServiceClient: vi.fn().mockImplementation(() => mockSupabaseClient()),
}))

vi.mock('@/lib/supabase/client', () => ({
  createBrowserClient: vi.fn().mockImplementation(() => mockSupabaseClient()),
}))

// ── Next.js mocks ──────────────────────────────────────────────────────────
vi.mock('next/navigation', () => ({
  useRouter:    () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname:  () => '/dashboard/admin',
  useSearchParams: () => new URLSearchParams(),
  redirect:     vi.fn(),
  notFound:     vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag:  vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: () => ({
    get:    vi.fn().mockReturnValue({ value: 'mock-cookie' }),
    set:    vi.fn(),
    delete: vi.fn(),
  }),
}))

// ── Shared mock builder ────────────────────────────────────────────────────
// Root-cause fix (2026-07-13, Next.js 15/16 upgrade): createClient() is now
// async everywhere in real app code (cookies() became async), so every
// caller does `await createClient()`. This builder is deliberately
// thenable at the query-chain level (`then` below) so a bare
// `await supabase.from(...).select(...)` — with no .single()/.maybeSingle()
// terminal — still resolves to { data, error, count }, matching real
// Supabase's PostgrestFilterBuilder behavior. But `builder.from()` returns
// the SAME object as the client itself (mockReturnThis() chaining), so
// `await createClient()` (which returns this same thenable object) got
// silently swallowed by the native Promise-resolution algorithm recursively
// unwrapping it via that same `then` — which (before this fix) never called
// its resolve/reject callbacks, so the await just hung forever. Confirmed
// live: every test awaiting `createClient()` timed out at 10s.
// Fixed by wrapping the returned value in a Proxy that hides `then` ONLY at
// the top level (so awaiting the client itself resolves immediately, not
// through query-result resolution) while every other property — including
// from(), which still returns the real underlying (thenable) builder for
// proper query-chain awaiting — passes through unchanged.
export function mockSupabaseClient(overrides: Record<string, any> = {}) {
  const builder: any = {
    select:   vi.fn().mockReturnThis(),
    insert:   vi.fn().mockReturnThis(),
    update:   vi.fn().mockReturnThis(),
    delete:   vi.fn().mockReturnThis(),
    upsert:   vi.fn().mockReturnThis(),
    eq:       vi.fn().mockReturnThis(),
    neq:      vi.fn().mockReturnThis(),
    in:       vi.fn().mockReturnThis(),
    not:      vi.fn().mockReturnThis(),
    or:       vi.fn().mockReturnThis(),
    gte:      vi.fn().mockReturnThis(),
    lte:      vi.fn().mockReturnThis(),
    lt:       vi.fn().mockReturnThis(),
    order:    vi.fn().mockReturnThis(),
    limit:    vi.fn().mockReturnThis(),
    range:    vi.fn().mockReturnThis(),
    single:   vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    textSearch: vi.fn().mockReturnThis(),
    // A real thenable now (delegates to a genuine Promise) instead of
    // vi.fn().mockResolvedValue(...), which never invoked the
    // (resolve, reject) callbacks the native `await` mechanism passes it —
    // that was the direct cause of the hang described above.
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(resolve, reject),
    rpc:      vi.fn().mockResolvedValue({ data: true, error: null }),
    auth: {
      getUser:  vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut:  vi.fn().mockResolvedValue({ error: null }),
      admin: {
        createUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-123', email: 'test@test.com' } }, error: null }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
    from: vi.fn().mockReturnThis(),
    ...overrides,
  }

  // Make from() return the builder (enables chaining)
  builder.from.mockReturnValue(builder)

  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === 'then') return undefined
      return Reflect.get(target, prop, receiver)
    },
  })
}

// ── Test fixtures ──────────────────────────────────────────────────────────
export const fixtures = {
  company: {
    id:   'company-123',
    name: 'Test Collection Co',
    slug: 'test-collection-co',
    plan: 'growth',
    is_active: true,
    settings: { currency: 'SAR', timezone: 'Asia/Riyadh' },
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  adminProfile: {
    id:         'admin-user-123',
    company_id: 'company-123',
    email:      'admin@testco.com',
    full_name:  'Test Admin',
    role:       'admin' as const,
    is_active:  true,
  },
  collectorProfile: {
    id:         'collector-user-456',
    company_id: 'company-123',
    email:      'collector@testco.com',
    full_name:  'Test Collector',
    role:       'collector' as const,
    is_active:  true,
  },
  customer: {
    id:           'customer-789',
    company_id:   'company-123',
    full_name:    'Ahmed Al-Rashid',
    phone:        '+966501234567',
    whatsapp:     '+966501234567',
    national_id:  '1234567890',
    city:         'Riyadh',
    employer:     'Saudi Aramco',
    monthly_income: 15000,
    risk_level:   'medium' as const,
    created_at:   '2024-01-01T00:00:00Z',
    updated_at:   '2024-01-01T00:00:00Z',
  },
  debt: {
    id:               'debt-abc',
    company_id:       'company-123',
    customer_id:      'customer-789',
    assigned_to:      null,
    reference_number: 'DEBT-2024-001',
    original_amount:  50000,
    current_balance:  45000,
    currency:         'SAR',
    status:           'active' as const,
    priority:         'high' as const,
    due_date:         '2024-06-01',
    last_payment_date: null,
    interest_rate:    0,
    product_type:     'Personal Loan',
    notes:            null,
    created_at:       '2024-01-01T00:00:00Z',
    updated_at:       '2024-01-01T00:00:00Z',
  },
  payment: {
    id:             'payment-001',
    company_id:     'company-123',
    debt_id:        'debt-abc',
    customer_id:    'customer-789',
    amount:         5000,
    currency:       'SAR',
    payment_method: 'bank_transfer' as const,
    payment_date:   '2024-03-01',
    status:         'completed' as const,
    created_at:     '2024-03-01T00:00:00Z',
  },
  aiScore: {
    id:                     'score-001',
    company_id:             'company-123',
    debt_id:                'debt-abc',
    customer_id:            'customer-789',
    score:                  72,
    risk_classification:    'medium' as const,
    collection_probability: 0.65,
    recommended_strategy:   'Direct negotiation with payment plan offer',
    factors:                [
      { name: 'Payment history',  impact: 'positive', weight: 8, description: 'Has made 1 payment' },
      { name: 'Days overdue',     impact: 'negative', weight: 6, description: '90 days overdue' },
    ],
    created_at: '2024-03-01T00:00:00Z',
  },
}

afterEach(() => {
  vi.clearAllMocks()
})
