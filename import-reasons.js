const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function run() {
  require('dotenv').config({ path: '.env.local' });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase credentials not found in .env.local');
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log('Fetching CSV...');
  const res = await fetch('https://docs.google.com/spreadsheets/d/1HTGZj4Erq7LfEksTbCgKgH8mv5JxFFWPk-gx9S5VITE/export?format=csv');
  const csvText = await res.text();
  
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  const headers = lines[0].split(',');
  
  console.log('Headers:', headers);

  let updated = 0;
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    
    const accNumber = row[0]; // رقم الحساب
    const accidentNumber = row[4]; // رقم الحادث
    const faultPercentage = row[5]; // نسبة الخطا
    const carType = row[12]; // نوع السيارة
    const plate = row[13]; // لوحة السيارة
    const reason = row[15]; // سبب حق الرجوع
    const accidentDate = row[16]; // تاريخ الحادث

    if (!accidentNumber) continue;

    const note = `تفاصيل المطالبة (حق الرجوع):\n- تاريخ الحادث: ${accidentDate}\n- المركبة: ${carType} (لوحة: ${plate})\n- نسبة الإدانة: ${faultPercentage}%\n- السبب الرئيسي: ${reason}`;

    // Update the debt notes in DB matching either reference_number = accidentNumber OR account_number = accNumber
    const { data: debts, error } = await supabase
      .from('debts')
      .select('id, notes')
      .or(`reference_number.eq.${accidentNumber},account_number.eq.${accNumber}`);
      
    if (error) {
      console.error('Error finding debt:', error.message);
      continue;
    }

    if (debts && debts.length > 0) {
      for (const debt of debts) {
        let existingNotes = debt.notes || '';
        // Only append if not already there
        if (!existingNotes.includes(reason)) {
          const newNotes = existingNotes ? `${existingNotes}\n\n${note}` : note;
          await supabase.from('debts').update({ notes: newNotes }).eq('id', debt.id);
          console.log(`Updated notes for debt ${debt.id} (${accidentNumber})`);
          updated++;
        } else {
          console.log(`Notes already contain reason for debt ${debt.id} (${accidentNumber})`);
        }
      }
    } else {
      console.log(`Debt not found for accident: ${accidentNumber}`);
    }
  }

  console.log(`Finished processing. Updated ${updated} debts.`);
}

run().catch(console.error);
