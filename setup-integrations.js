const { createClient } = require('@supabase/supabase-js')


const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseKey)

async function setupIntegrations() {
  // 1. Get the primary company
  const { data: companies, error: compErr } = await supabase.from('companies').select('id').limit(1)
  
  if (compErr || !companies || companies.length === 0) {
    console.error('Failed to fetch company', compErr)
    return
  }
  
  const companyId = companies[0].id
  console.log(`Setting up integrations for company ID: ${companyId}`)

  // 2. n8n Integration Payload
  const n8nPayload = {
    company_id: companyId,
    integration_name: 'n8n_automation',
    enabled: true,
    config: {
      webhook_url: 'http://72.62.30.109:32768',
      auth_token: ''
    }
  }

  // 3. Evolution WhatsApp Payload
  const evoPayload = {
    company_id: companyId,
    integration_name: 'evolution_whatsapp',
    enabled: true,
    config: {
      api_url: 'http://72.62.30.109:32769/',
      api_key: 'yW9pHPPCn5btvjeqFr2rUdo0gS8KOebB',
      instance_name: 'ai-debt-mainmobily-instance'
    }
  }

  // UPSERT n8n
  const { error: err1 } = await supabase
    .from('integration_settings')
    .upsert(n8nPayload, { onConflict: 'company_id, integration_name' })
  
  if (err1) console.error('Error inserting n8n:', err1)
  else console.log('Successfully configured n8n_automation!')

  // UPSERT Evolution
  const { error: err2 } = await supabase
    .from('integration_settings')
    .upsert(evoPayload, { onConflict: 'company_id, integration_name' })
  
  if (err2) console.error('Error inserting evolution:', err2)
  else console.log('Successfully configured evolution_whatsapp!')
}

setupIntegrations()
