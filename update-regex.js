const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'src', 'lib', 'ai-whatsapp-reply.ts')
let content = fs.readFileSync(filePath, 'utf8')

// Update clean function
content = content.replace(/function clean\(reply: string\) \{/g, 'function clean(reply: string, customerName?: string) {')
content = content.replace(/return String\(reply \?\? ''\)/g, `let r = String(reply ?? '')
  if (customerName) {
    const names = customerName.split(' ')
    const firstName = names[0]
    if (firstName) {
       const re = new RegExp(\`(هلا|مرحبا|يا|أهلين)\\\\s*\${firstName}[،,\\\\s]*\`, 'g')
       r = r.replace(re, '')
    }
  }
  return r`)

// Update finalGuard signature
content = content.replace(/function finalGuard\(args: \{\n  current: string\n  history: HistoryItem\[\]\n  reply: string\n  debtContext: any\n\}\) \{/g, `function finalGuard(args: {
  current: string
  history: HistoryItem[]
  reply: string
  debtContext: any
  customerName?: string
}) {`)

// Update finalGuard clean call
content = content.replace(/const reply = clean\(args\.reply\)/g, 'const reply = clean(args.reply, args.customerName)')

// Update finalGuard usage inside generateWhatsappAutoReply
content = content.replace(/const debtContext = await buildCustomerDebtContext\(\{\n    company_id: args\.company_id,\n    customer_id: args\.customer_id,\n    debt_id: args\.debt_id \?\? null,\n  \}\)/g, `const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })
  
  const customerName = debtContext?.customer?.full_name ?? ''`)

content = content.replace(/const hardReply = finalGuard\(\{\n    current: text,\n    history,\n    reply: asksDebtDetails\(text\) \? debtAnswer\(debtContext\) : '',\n    debtContext,\n  \}\)/g, `const hardReply = finalGuard({
    current: text,
    history,
    reply: asksDebtDetails(text) ? debtAnswer(debtContext) : '',
    debtContext,
    customerName,
  })`)

content = content.replace(/const finalReply = finalGuard\(\{\n    current: text,\n    history,\n    reply: decision\.reply,\n    debtContext,\n  \}\)/g, `const finalReply = finalGuard({
    current: text,
    history,
    reply: decision.reply,
    debtContext,
    customerName,
  })`)

fs.writeFileSync(filePath, content, 'utf8')
console.log('Regex update complete.')
