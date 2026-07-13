import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_ROUTES = [
  '/login',
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

export async function proxy(request: NextRequest) {
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

  const isDummyUrl = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('dummy')
  
  let user: any = null
  if (isDummyUrl) {
    const hasSession = request.cookies.has('mock-auth-logged-in')
    if (hasSession) {
      user = {
        id: 'bbbbbbbb-0000-4000-8000-000000000001',
        email: 'admin@aidebtos.com',
        user_metadata: { role: 'admin', full_name: 'Admin User' }
      } as any
    }
  } else {
    try {
      const { data } = await supabase.auth.getUser()
      user = data.user
    } catch (e) {
      user = null
    }
  }

  const isPublic = PUBLIC_ROUTES.some(r => pathname.startsWith(r))

  // Redirect unauthenticated users to login
  if (!user && !isPublic && pathname.startsWith('/dashboard')) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('next', pathname)
    return applySecurityHeaders(NextResponse.redirect(loginUrl))
  }

  // Redirect authenticated users away from auth pages to dashboard
  if (user && pathname === '/login') {
    let role = 'admin'
    if (!isDummyUrl) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single()
        role = profile?.role ?? 'collector'
      } catch (e) {
        role = 'collector'
      }
    }
    const dest = request.nextUrl.clone()
    dest.pathname = `/dashboard/${role}`
    return applySecurityHeaders(NextResponse.redirect(dest))
  }

  // Role-based guards and Active checks on dashboard sub-routes
  if (user && pathname.startsWith('/dashboard')) {
    if (!isDummyUrl) {
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_active')
          .eq('id', user.id)
          .single()
        
        if (profile && profile.is_active === false) {
          // Force signout cookies
          request.cookies.getAll().forEach(c => {
            if (c.name.startsWith('sb-')) response.cookies.delete(c.name)
          })
          const loginUrl = request.nextUrl.clone()
          loginUrl.pathname = '/login'
          loginUrl.searchParams.set('inactive', 'true')
          return applySecurityHeaders(NextResponse.redirect(loginUrl))
        }
      } catch (e) {
        // Fallback
      }

      // MFA enforcement, checked on every dashboard request (not just at
      // login) - real gap this closes: a login-time-only redirect to
      // /mfa-challenge or /mfa-setup is trivially bypassed by navigating
      // directly to a /dashboard/* URL, since nothing else re-checks the
      // session's actual authenticator assurance level afterward.
      try {
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2') {
          // a verified TOTP factor exists but this session hasn't completed
          // the challenge yet
          const dest = request.nextUrl.clone()
          dest.pathname = '/mfa-challenge'
          return applySecurityHeaders(NextResponse.redirect(dest))
        }
        if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal1') {
          // no factor enrolled at all - mandatory for privileged roles
          const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
          if (profile && ['admin', 'manager'].includes(profile.role)) {
            const dest = request.nextUrl.clone()
            dest.pathname = '/mfa-setup'
            dest.searchParams.set('required', 'true')
            return applySecurityHeaders(NextResponse.redirect(dest))
          }
        }
      } catch (e) {
        // Fallback - never block dashboard access due to an MFA-check error
      }
    }
  }

  return applySecurityHeaders(response)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)',
  ],
}
