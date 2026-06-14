const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'src', 'lib', 'ai-whatsapp-reply.ts')
let content = fs.readFileSync(filePath, 'utf8')

// 1. clean
const cleanOld = `function clean(reply: string) {
  return String(reply ?? '')`
const cleanNew = `function clean(reply: string, customerName?: string) {
  let r = String(reply ?? '')
  if (customerName) {
    const names = customerName.split(' ')
    const firstName = names[0]
    if (firstName) {
       const re = new RegExp(\`(هلا|مرحبا|يا|أهلين)\\\\s*\${firstName}[،,\\\\s]*\`, 'g')
       r = r.replace(re, '')
    }
  }
  return r`
content = content.replace(cleanOld, cleanNew)

// 2. finalGuard signature
const fgOld = `function finalGuard(args: {
  current: string
  history: HistoryItem[]
  reply: string
  debtContext: any
}) {
  const reply = clean(args.reply)`
const fgNew = `function finalGuard(args: {
  current: string
  history: HistoryItem[]
  reply: string
  debtContext: any
  customerName?: string
}) {
  const reply = clean(args.reply, args.customerName)`
content = content.replace(fgOld, fgNew)

// 3. hardReply usage
const hrOld = `  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const hardReply = finalGuard({
    current: text,
    history,
    reply: asksDebtDetails(text) ? debtAnswer(debtContext) : '',
    debtContext,
  })`
const hrNew = `  const debtContext = await buildCustomerDebtContext({
    company_id: args.company_id,
    customer_id: args.customer_id,
    debt_id: args.debt_id ?? null,
  })

  const customerName = debtContext?.customer?.full_name ?? ''

  const hardReply = finalGuard({
    current: text,
    history,
    reply: asksDebtDetails(text) ? debtAnswer(debtContext) : '',
    debtContext,
    customerName,
  })`
content = content.replace(hrOld, hrNew)

// 4. finalReply usage
const frOld = `  const finalReply = finalGuard({
    current: text,
    history,
    reply: decision.reply,
    debtContext,
  })`
const frNew = `  const finalReply = finalGuard({
    current: text,
    history,
    reply: decision.reply,
    debtContext,
    customerName,
  })`
content = content.replace(frOld, frNew)

fs.writeFileSync(filePath, content, 'utf8')
console.log('Update successful')
