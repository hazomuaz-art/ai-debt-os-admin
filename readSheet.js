const https = require('https');
const fs = require('fs');
const xlsx = require('xlsx');

const url = 'https://docs.google.com/spreadsheets/d/1HTGZj4Erq7LfEksTbCgKgH8mv5JxFFWPk-gx9S5VITE/export?format=xlsx';

https.get(url, (res) => {
  if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
    https.get(res.headers.location, (res2) => {
      handleStream(res2);
    });
  } else {
    handleStream(res);
  }
});

function handleStream(res) {
  const file = fs.createWriteStream('sheet.xlsx');
  res.pipe(file);
  file.on('finish', () => {
    file.close(() => {
      const workbook = xlsx.readFile('sheet.xlsx');
      console.log('Sheets found:', workbook.SheetNames);
      workbook.SheetNames.forEach(sheetName => {
        console.log(`\n--- Sheet: ${sheetName} ---`);
        const sheet = workbook.Sheets[sheetName];
        console.log(xlsx.utils.sheet_to_csv(sheet).substring(0, 500));
      });
    });
  });
}
