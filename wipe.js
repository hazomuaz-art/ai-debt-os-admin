const fs = require('fs');
const envFile = fs.readFileSync('.env.local', 'utf8');
envFile.split('\n').forEach(line => {
  if (line && line.includes('=')) {
    const parts = line.split('=');
    process.env[parts[0]] = parts.slice(1).join('=').trim();
  }
});

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function wipe() {
  console.log("Starting data wipe...");
  
  // Order matters! Child tables first.
  const tables = [
    'timeline_events',
    'messages',
    'payments',
    'ai_scores',
    'ai_actions',
    'ai_cost_log', // Added to handle foreign key constraints
    'promises',
    'approvals',
    'collection_followups',
    'collection_status_history',
    'collection_assignments',
    'system_alerts',
    'campaigns',
    'portfolio_whatsapp_numbers',
    'debts',
    'customers',
    'portfolios'
  ];

  for (const table of tables) {
    console.log(`Fetching IDs for ${table}...`);
    // Need to handle tables with more than 1000 items by repeatedly fetching until empty
    let hasMore = true;
    while(hasMore) {
        const { data, error } = await supabase.from(table).select('id').limit(1000);
        
        if (error) {
          console.error(`Error fetching ${table}:`, error.message);
          hasMore = false;
          continue;
        }

        if (data && data.length > 0) {
          const ids = data.map(d => d.id);
          console.log(`Deleting ${ids.length} records from ${table}...`);
          
          // Delete in chunks of 50 to avoid "URI too long" / Bad Request
          for (let i = 0; i < ids.length; i += 50) {
            const chunk = ids.slice(i, i + 50);
            const { error: delError } = await supabase.from(table).delete().in('id', chunk);
            if (delError) {
              console.error(`Error deleting chunk from ${table}:`, delError.message);
            }
          }
        } else {
          console.log(`${table} is empty.`);
          hasMore = false;
        }
    }
  }

  console.log("Wipe completed successfully.");
}

wipe();
