const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: promises, error } = await supabase.from('promises').select('*');
  console.log('Promises:', promises);
  
  const { data: debts } = await supabase.from('debts').select('id, reference_number');
  console.log('Debts count:', debts ? debts.length : 0);
}

check().catch(console.error);
