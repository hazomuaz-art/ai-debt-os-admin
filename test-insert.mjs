import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function run() {
  const { error } = await supabase.from('approvals').insert({
    company_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    approval_type: 'payment_plan',
    title: 'طلب موافقة على تقسيط',
    description: 'Test approval insert.',
    entity_type: 'debt',
    entity_id: '935b9723-7b95-4ca3-8a80-2742228633ed',
    status: 'pending',
    priority: 'high',
  })
  console.log('Insert error:', error || 'Success')
}
run()
