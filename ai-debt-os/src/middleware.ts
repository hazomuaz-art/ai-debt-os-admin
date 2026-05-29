import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/api/whatsapp/webhook',
  '/api/health',
]

const SECURITY_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':         'DENY',
  'X-XSS-Protection':        '1; mode=block',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
}

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value)
  }
  return response
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  )
}

// Simple in-memory rate limiter (per-instance, good enough for edge)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()
const API_RATE_LIMITS: Record<string, number> = {
  '/api/ai/score':      50,
  '/api/ai/recommend':  10,
  '/api/whatsapp/send': 200,
  '/api/debts/import':  5,
  '/api/auth/invite':   20,
}

function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(key)
  if (!entry || entry.resetAt <= now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + 3_600_000 })
    return true
  }
  if (entry.count >= limit) return false
  entry.count++
  return true
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const ip = getClientIp(request)

  // Rate limit API routes
  for (const [route, limit] of Object.entries(API_RATE_LIMITS)) {
    if (pathname.startsWith(route)) {
      if (!checkRateLimit(`${route}:${ip}`, limit)) {
        return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
      }
      break
    }
  }

  // Block path traversal
  if (pathname.includes('..')) {
    return new NextResponse(null, { status: 400 })
  }

  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return request.cookies.get(name)?.value },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isPublic = PUBLIC_ROUTES.some(r => pathname.startsWith(r))

  // Redirect unauthenticated users to login
  if (!user && !isPublic && pathname.startsWith('/dashboard')) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return applySecurityHeaders(NextResponse.redirect(loginUrl))
  }

  // Redirect authenticated users away from auth pages to dashboard
  if (user && (pathname === '/login' || pathname === '/register')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    const role = profile?.role ?? 'collector'
    const dest = request.nextUrl.clone()
    dest.pathname = `/dashboard/${role}`
    return applySecurityHeaders(NextResponse.redirect(dest))
  }

  // Role-based guards on dashboard sub-routes
  if (user && pathname.startsWith('/dashboard')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active, company_id')
      .eq('id', user.id)
      .single()

    if (!profile?.is_active) {
      await supabase.auth.signOut()
      const dest = request.nextUrl.clone()
      dest.pathname = '/login'
      dest.searchParams.set('error', 'account_disabled')
      return applySecurityHeaders(NextResponse.redirect(dest))
    }

    if (!profile?.company_id) {
      const dest = request.nextUrl.clone()
      dest.pathname = '/register'
      return applySecurityHeaders(NextResponse.redirect(dest))
    }

    const role = profile.role ?? 'collector'

    if (pathname.startsWith('/dashboard/admin') && role !== 'admin') {
      const dest = request.nextUrl.clone()
      dest.pathname = `/dashboard/${role}`
      return applySecurityHeaders(NextResponse.redirect(dest))
    }

    if (pathname.startsWith('/dashboard/manager') && !['admin', 'manager'].includes(role)) {
      const dest = request.nextUrl.clone()
      dest.pathname = '/dashboard/collector'
      return applySecurityHeaders(NextResponse.redirect(dest))
    }
  }

  return applySecurityHeaders(response)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
}
