import { NextRequest, NextResponse } from 'next/server'
import { z, ZodSchema, ZodError } from 'zod'
import { createClient, createServiceClient } from '@/lib/supabase/server'

import { createLogger } from '@/lib/logger'
// ============================================================
// Standard API Error Response
// ============================================================

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'CONFLICT'
  | 'BAD_REQUEST'

export interface ApiError {
  error:    string
  code:     ApiErrorCode
  details?: Record<string, string[]>
}

export function apiError(
  message: string,
  code:    ApiErrorCode,
  status:  number,
  details?: Record<string, string[]>
): NextResponse<ApiError> {
  return NextResponse.json({ error: message, code, details }, { status })
}

export const errors = {
  unauthorized: (): NextResponse<ApiError> =>
    apiError('Authentication required', 'UNAUTHORIZED', 401),
  forbidden: (): NextResponse<ApiError> =>
    apiError('Insufficient permissions', 'FORBIDDEN', 403),
  notFound: (entity = 'Resource'): NextResponse<ApiError> =>
    apiError(`${entity} not found`, 'NOT_FOUND', 404),
  rateLimited: (): NextResponse<ApiError> =>
    apiError('Rate limit exceeded. Please try again later.', 'RATE_LIMITED', 429),
  internal: (msg = 'Internal server error'): NextResponse<ApiError> =>
    apiError(msg, 'INTERNAL_ERROR', 500),
  conflict: (msg: string): NextResponse<ApiError> =>
    apiError(msg, 'CONFLICT', 409),
  badRequest: (msg: string): NextResponse<ApiError> =>
    apiError(msg, 'BAD_REQUEST', 400),
  validation: (err: ZodError): NextResponse<ApiError> => {
    const details: Record<string, string[]> = {}
    for (const issue of err.issues) {
      const path = issue.path.join('.') || '_root'
      if (!details[path]) details[path] = []
      details[path].push(issue.message)
    }
    return apiError('Validation failed', 'VALIDATION_ERROR', 422, details)
  },
}

// ============================================================
// Auth context passed to every handler
// ============================================================

export interface AuthContext {
  user: {
    id:    string
    email: string
  }
  profile: {
    id:         string
    company_id: string
    role:       'admin' | 'manager' | 'collector'
    full_name:  string | null
    is_active:  boolean
  }
  supabase:      Awaited<ReturnType<typeof createClient>>
  serviceClient: ReturnType<typeof createServiceClient>
}

type AuthedHandler = (ctx: AuthContext) => Promise<NextResponse>

// ============================================================
// withAuth — wraps a handler with auth, role check, error boundary
// ============================================================

export async function withAuth(
  handler: AuthedHandler,
  options?: { requiredRoles?: Array<'admin' | 'manager' | 'collector'> }
): Promise<NextResponse> {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) return errors.unauthorized()

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, company_id, role, full_name, is_active')
    .eq('id', user.id)
    .single()

  if (!profile)            return errors.unauthorized()
  if (!profile.is_active)  return errors.forbidden()
  if (!profile.company_id) return errors.forbidden()

  if (options?.requiredRoles && !options.requiredRoles.includes(profile.role as 'admin' | 'manager' | 'collector')) {
    return errors.forbidden()
  }

  const ctx: AuthContext = {
    user:          { id: user.id, email: user.email ?? '' },
    profile:       profile as AuthContext['profile'],
    supabase,
    serviceClient: createServiceClient(),
  }

  try {
    return await handler(ctx)
  } catch (err) {
    createLogger('api').error('Unhandled error', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return errors.internal(
      process.env.NODE_ENV === 'production' ? 'Internal server error' : message
    )
  }
}

// ============================================================
// Request body parsing with Zod validation
// ============================================================

export async function parseBody<T>(
  request: NextRequest | Request,
  schema:  ZodSchema<T>
): Promise<{ data: T; error: null } | { data: null; error: NextResponse<ApiError> }> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return { data: null, error: errors.badRequest('Invalid JSON body') }
  }

  const result = schema.safeParse(body)
  if (!result.success) {
    return { data: null, error: errors.validation(result.error) }
  }
  return { data: result.data, error: null }
}

// ============================================================
// Query param parsing with Zod validation
// ============================================================

export function parseQuery<T>(
  searchParams: URLSearchParams,
  schema:       ZodSchema<T>
): { data: T; error: null } | { data: null; error: NextResponse<ApiError> } {
  const raw: Record<string, string> = {}
  for (const [key, value] of searchParams.entries()) {
    raw[key] = value
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    return { data: null, error: errors.validation(result.error) }
  }
  return { data: result.data, error: null }
}

// ============================================================
// Shared Zod schemas
// ============================================================

export const paginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export const uuidSchema = z.string().uuid('Invalid ID format')

export const debtStatusSchema = z.enum([
  'active', 'in_progress', 'promised', 'partial',
  'in_negotiation', 'payment_plan',
  'settled', 'written_off', 'legal', 'disputed',
])

export const debtPrioritySchema = z.enum(['low', 'medium', 'high', 'critical'])

export const currencySchema = z.enum(['SAR', 'USD', 'EUR', 'AED', 'KWD', 'BHD', 'QAR', 'OMR'])

export const phoneSchema = z
  .string()
  .min(7)
  .max(20)
  .regex(/^\+?[\d\s\-().]{7,20}$/, 'Invalid phone number')
  .transform(p => p.replace(/[\s\-().]/g, ''))

export const scoreDebtSchema = z.object({
  debt_id: uuidSchema,
})

export const sendWhatsAppSchema = z.object({
  debt_id:     uuidSchema.optional(),
  customer_id: uuidSchema.optional(),
  phone:       phoneSchema,
  message:     z.string().min(1).max(4096),
})

export const recordPaymentSchema = z.object({
  debt_id:          uuidSchema,
  amount:           z.number().positive('Amount must be positive'),
  payment_date:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  payment_method:   z.enum(['bank_transfer', 'cash', 'check', 'online', 'other']).optional(),
  reference_number: z.string().max(100).optional(),
  notes:            z.string().max(500).optional(),
})

export const createDebtSchema = z.object({
  customer_id:     uuidSchema,
  original_amount: z.number().positive(),
  current_balance: z.number().min(0).optional(),
  currency:        currencySchema.default('SAR'),
  status:          debtStatusSchema.default('active'),
  priority:        debtPrioritySchema.default('medium'),
  due_date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  product_type:    z.string().max(100).optional(),
  creditor_name:   z.string().max(200).optional(),
  account_number:  z.string().max(100).optional(),
  assigned_to:     uuidSchema.optional(),
  interest_rate:   z.number().min(0).max(100).default(0),
  notes:           z.string().max(1000).optional(),
})

export const createCustomerSchema = z.object({
  full_name:      z.string().min(2).max(200),
  email:          z.string().email().optional().or(z.literal('')).transform(v => v || undefined),
  phone:          phoneSchema.optional(),
  whatsapp:       phoneSchema.optional(),
  national_id:    z.string().max(50).optional(),
  city:           z.string().max(100).optional(),
  employer:       z.string().max(200).optional(),
  monthly_income: z.number().min(0).optional(),
  notes:          z.string().max(1000).optional(),
  address:        z.string().max(500).optional(),
})

export const inviteUserSchema = z.object({
  email:      z.string().email(),
  full_name:  z.string().min(2).max(200),
  // 'admin' is deliberately excluded — granting admin via this API would let
  // any existing admin silently create another full admin without a more
  // deliberate, audited path. Promote to admin manually if ever needed.
  role:       z.enum(['manager', 'collector']),
  password:   z.string().min(8).max(72),
  company_id: uuidSchema,
})

export const listDebtsQuerySchema = paginationSchema.extend({
  status:      debtStatusSchema.optional(),
  priority:    debtPrioritySchema.optional(),
  assigned_to: uuidSchema.optional(),
  search:      z.string().max(100).optional(),
})
