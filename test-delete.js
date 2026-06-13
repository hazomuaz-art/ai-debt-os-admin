require('dotenv').config({ path: '.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testDelete() {
  const email = 'muaxhuzifa@gmail.com';
  
  console.log('Fetching user:', email);
  const { data: users, error: listErr } = await supabase.auth.admin.listUsers();
  
  if (listErr) {
    console.error('List error:', listErr);
    return;
  }
  
  const user = users?.users?.find(u => u.email === email);
  
  if (!user) {
    console.log('User not found by email');
    return;
  }
  
  const targetUserId = user.id;
  console.log('Found user:', targetUserId);

  console.log('Attempting to delete...');
  const { error: deleteErr } = await supabase.auth.admin.deleteUser(targetUserId);
  
  if (deleteErr) {
    console.log('Delete result error:', JSON.stringify(deleteErr, null, 2));
  } else {
    console.log('Delete successful!');
  }
}

testDelete();
