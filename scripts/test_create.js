const url = 'http://72.62.30.109:32769/instance/create';
const apiKey = 'yW9pHPPCn5btvjeqFr2rUdo0gS8KOebB';

const body = {
  instanceName: 'ai-debt-mainmobily-instance',
  qrcode: true,
  integration: 'WHATSAPP-BAILEYS'
};

console.log('Sending request to:', url);

fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'apikey': apiKey
  },
  body: JSON.stringify(body)
})
.then(res => res.json().then(data => ({ status: res.status, data })))
.then(({ status, data }) => {
  console.log(`Response Status: ${status}`);
  console.log('Response Body:', JSON.stringify(data, null, 2));
})
.catch(err => {
  console.error('Fetch error:', err);
});
