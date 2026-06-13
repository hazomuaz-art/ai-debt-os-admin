const fs = require('fs');

async function run() {
  const res = await fetch('https://docs.google.com/spreadsheets/d/1HTGZj4Erq7LfEksTbCgKgH8mv5JxFFWPk-gx9S5VITE/export?format=csv');
  const csvText = await res.text();
  
  const lines = csvText.split('\n').map(l => l.trim()).filter(Boolean);
  
  const reasonsMap = {};

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    
    const accNumber = row[0]; 
    const accidentNumber = row[4]; 
    const faultPercentage = row[5]; 
    const carType = row[12]; 
    const plate = row[13]; 
    const reason = row[15]; 
    const accidentDate = row[16]; 

    if (!accidentNumber) continue;

    reasonsMap[accidentNumber] = {
      accidentDate,
      carType,
      plate,
      faultPercentage,
      reason
    };
    
    // Also map by account number just in case
    if (accNumber) {
      reasonsMap[accNumber] = reasonsMap[accidentNumber];
    }
  }

  fs.writeFileSync('./src/lib/insurance_reasons.json', JSON.stringify(reasonsMap, null, 2));
  console.log('Saved to src/lib/insurance_reasons.json');
}

run().catch(console.error);
