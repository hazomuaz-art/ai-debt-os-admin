const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'src', 'lib', 'ai-whatsapp-reply.ts')
let content = fs.readFileSync(filePath, 'utf8')

content = content.replace(
  "model: process.env.OPENROUTER_API_KEY ? 'google/gemini-3.1-pro-preview' : 'gpt-4o',",
  "model: 'gpt-5.5',"
)

content = content.replace(
  "model: process.env.OPENROUTER_API_KEY ? 'google/gemini-3.1-pro-preview' : 'gpt-4o',",
  "model: 'gpt-5.5',"
)

content = content.replace(
  "apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,",
  "apiKey: process.env.OPENAI_API_KEY,"
)

content = content.replace(
  "apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY,",
  "apiKey: process.env.OPENAI_API_KEY,"
)

content = content.replace(
  "baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined",
  "// baseURL removed"
)

content = content.replace(
  "baseURL: process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : undefined",
  "// baseURL removed"
)

fs.writeFileSync(filePath, content, 'utf8')
console.log('Updated to gpt-5.5')
