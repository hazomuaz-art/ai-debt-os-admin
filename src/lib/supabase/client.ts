import { createBrowserClient } from '@supabase/ssr'
import { getMockSupabaseClient } from './mock'

const isDummyUrl = !process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL.includes('dummy')

export function createClient() {
  if (isDummyUrl) {
    return getMockSupabaseClient()
  }

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

