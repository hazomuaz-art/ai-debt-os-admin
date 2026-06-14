import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  // Check the requests
  const { data: approvals } = await supabase.from('approvals').select('*').order('created_at', { ascending: false }).limit(5)
  console.log('Last 5 approvals:', JSON.stringify(approvals, null, 2))
  
  // Clear all pending approvals
  const { error } = await supabase.from('approvals').delete().neq('status', 'ignore_me_just_delete_all')
  console.log('Delete all approvals result:', error || 'Success')
}

run()
