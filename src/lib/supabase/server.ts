import { createServerClient as _createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient as _createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { getMockSupabaseClient } from './mock'

const isDummyUrl = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('dummy')

/**
 * Server-side Supabase client for the App Router.
 * Next.js 15+: cookies() is async, so this is now async too — every caller
 * must `await createClient()`.
 * Call this in Server Components, Route Handlers, and Server Actions.
 */
export async function createClient() {
  if (isDummyUrl) {
    return getMockSupabaseClient()
  }

  const cookieStore = await cookies()

  return _createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          try { cookieStore.set({ name, value, ...options }) } catch {}
        },
        remove(name: string, options: CookieOptions) {
          try { cookieStore.set({ name, value: '', ...options }) } catch {}
        },
      },
    }
  )
}

/**
 * Service role client — bypasses RLS.
 * Only use in trusted server-side contexts (webhook, job worker, invite).
 */
export function createServiceClient() {
  if (isDummyUrl) {
    return getMockSupabaseClient()
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set')
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')
  }

  return _createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken:  false,
        persistSession:    false,
      },
    }
  )
}

