import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function Home() {
  // TEMPORARY: Bypass auth redirect for UI preview
  redirect('/dashboard/admin')
}
