const { createClient } = require('@supabase/supabase-js')



const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

const EVOLUTION_API_URL = 'http://72.62.30.109:32769'
const EVOLUTION_API_KEY = 'yW9pHPPCn5btvjeqFr2rUdo0gS8KOebB'
const INSTANCE_NAME = 'ai-debt-mainmobily-instance'
const SYSTEM_WEBHOOK_URL = 'http://72.62.30.109/api/whatsapp/webhook'
const TEST_PHONE = '966510291183'

async function run() {
  // 1. Get company ID
  const { data: companies } = await supabase.from('companies').select('id').limit(1)
  const companyId = companies[0].id

  // 2. Upsert Customer
  console.log('1. Creating test customer...')
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .upsert({
      company_id: companyId,
      full_name: 'Test Customer (Manager)',
      phone: TEST_PHONE,
      whatsapp: TEST_PHONE,
      national_id: '1234567890'
    }, { onConflict: 'national_id' }) // Just upserting based on a dummy ID or we can just insert and ignore errors.
    .select()

  // Let's just do a manual check and insert to avoid constraint errors if national_id doesn't have unique
  const { data: existing } = await supabase.from('customers').select('id').eq('phone', TEST_PHONE).single()
  let custId = existing?.id
  
  if (!custId) {
    const { data: newCust } = await supabase.from('customers').insert({
      company_id: companyId,
      full_name: 'Test Customer (Manager)',
      phone: TEST_PHONE,
      whatsapp: TEST_PHONE
    }).select().single()
    custId = newCust.id
  }

  // 3. Set Webhook on Evolution
  console.log('2. Setting up Evolution Webhook...')
  try {
    const hookRes = await fetch(`${EVOLUTION_API_URL}/webhook/set/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: SYSTEM_WEBHOOK_URL,
          webhook_by_events: false,
          webhook_base64: false,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE']
        }
      })
    })
    const hookData = await hookRes.json()
    console.log('Webhook Configured:', JSON.stringify(hookData, null, 2))
  } catch(e) {
    console.error('Failed to set webhook:', e.message)
  }

  // 4. Send Message via Evolution
  console.log('3. Sending Test Message...')
  try {
    const msgRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: TEST_PHONE,
        options: {
          delay: 1200,
          presence: 'composing'
        },
        text: 'مرحباً بك! 👋\nهذه رسالة تجريبية من نظام الذكاء الاصطناعي الخاص بك (AI Debt OS).\n\n*الآن حاول الرد على هذه الرسالة بأي سؤال أو استفسار لنختبر الرد الآلي!* 🤖'
      })
    })
    const msgData = await msgRes.json()
    console.log('Message Sent:', JSON.stringify(msgData, null, 2))
  } catch(e) {
    console.error('Failed to send message:', e.message)
  }
}

run()
