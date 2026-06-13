const fs = require('fs')
const path = 'C:\\Users\\moham\\.gemini\\antigravity-ide\\brain\\9ddbb025-51b7-459b-b89a-62f05fd51d17\\scratch\\qrcode.png'

fetch('http://72.62.30.109:32769/instance/connect/ai-debt-mainmobily-instance', {
  headers: { apikey: 'yW9pHPPCn5btvjeqFr2rUdo0gS8KOebB' }
})
.then(r => r.json())
.then(data => {
  if (data.base64) {
    const base64Data = data.base64.replace(/^data:image\/png;base64,/, '')
    fs.mkdirSync(require('path').dirname(path), { recursive: true })
    fs.writeFileSync(path, base64Data, 'base64')
    console.log('Saved to', path)
  } else {
    console.log('No base64 in response', data)
  }
})
.catch(err => console.error(err))
