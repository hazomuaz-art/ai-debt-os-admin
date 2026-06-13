const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://mnbmxtoujwaseibbaagh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1uYm14dG91andhc2VpYmJhYWdoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTcyMDA0OSwiZXhwIjoyMDk1Mjk2MDQ5fQ.f66KDM0CXphfwrl4uU1O_uFd1rQTusZVjxKekLUd15E';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('integration_settings')
    .select('*')
    .eq('integration_name', 'n8n_automation');
    
  if (error) {
    console.error('Error fetching:', error);
    return;
  }
  
  for (let row of data) {
    if (row.config && row.config.webhook_url) {
      row.config.webhook_url = row.config.webhook_url.replace('32768', '5678').replace('32771', '5678');
      
      const { error: updateError } = await supabase
        .from('integration_settings')
        .update({ config: row.config })
        .eq('id', row.id);
        
      if (updateError) {
        console.error('Failed to update:', updateError);
      } else {
        console.log(`Updated company ${row.company_id} to ${row.config.webhook_url}`);
      }
    }
  }
}

run();
