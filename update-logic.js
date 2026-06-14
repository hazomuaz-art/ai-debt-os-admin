const fs = require('fs')
const path = require('path')

const filePath = path.join(__dirname, 'src', 'lib', 'ai-whatsapp-reply.ts')
let content = fs.readFileSync(filePath, 'utf8')

// 1. Update asksDebtDetails
content = content.replace(
  "return hasAny(text, ['حقت شنو', 'حقت ايش', 'وش المديونية', 'سبب المديونية', 'المبلغ وش', 'تفاصيل', 'من وين', 'وضح'])",
  "return hasAny(text, ['حقت شنو', 'حقت ايش', 'وش المديونية', 'سبب المديونية', 'المبلغ وش', 'تفاصيل', 'من وين', 'وضح', 'مديونية ايش', 'بخصوص ايش', 'عن ايش', 'ايش المديونية', 'وش هي', 'م ادري عنها', 'ما ادري عنها', 'شنو المديونية', 'بخصوص المديونية'])"
)

// 2. Update clean function
const cleanOriginal = `function clean(reply: string) {
  return String(reply ?? '')
    .replace(/عزيزي العميل[،,\\s]*/g, '')`

const cleanReplacement = `function clean(reply: string, customerName?: string) {
  let r = String(reply ?? '')
  if (customerName) {
    const names = customerName.split(' ')
    const firstName = names[0]
    if (firstName) {
       const re = new RegExp(\`(هلا|مرحبا|يا|أهلين)\\\\s*\${firstName}[،,\\\\s]*\`, 'g')
       r = r.replace(re, '')
    }
  }
  
  return r
    .replace(/عزيزي العميل[،,\\s]*/g, '')`

content = content.replace(cleanOriginal, cleanReplacement)

// 3. Update finalGuard definition
const finalGuardDefOriginal = `function finalGuard(args: {
  current: string
  history: HistoryItem[]
  reply: string
  debtContext: any
}) {
  const reply = clean(args.reply)`

const finalGuardDefReplacement = `function finalGuard(args: {
  current: string
  history: HistoryItem[]
  reply: string
  debtContext: any
  customerName?: string
}) {
  const reply = clean(args.reply, args.customerName)`

content = content.replace(finalGuardDefOriginal, finalGuardDefReplacement)

// 4. Update finalGuard calls in generateWhatsappAutoReply
const hardReplyOriginal = `  const hardReply = finalGuard({
    current: text,
    history,
    reply: asksDebtDetails(text) ? debtAnswer(debtContext) : '',
    debtContext,
  })`

const hardReplyReplacement = `  const customerName = debtContext?.customer?.full_name ?? ''

  const hardReply = finalGuard({
    current: text,
    history,
    reply: asksDebtDetails(text) ? debtAnswer(debtContext) : '',
    debtContext,
    customerName,
  })`

content = content.replace(hardReplyOriginal, hardReplyReplacement)

const finalReplyOriginal = `  const finalReply = finalGuard({
    current: text,
    history,
    reply: decision.reply,
    debtContext,
  })`

const finalReplyReplacement = `  const finalReply = finalGuard({
    current: text,
    history,
    reply: decision.reply,
    debtContext,
    customerName,
  })`

content = content.replace(finalReplyOriginal, finalReplyReplacement)

// Increase temperature to 0.45 to prevent repetitive loops
content = content.replace('temperature: 0.08,', 'temperature: 0.45,')


fs.writeFileSync(filePath, content, 'utf8')
console.log('Successfully updated AI logic.')
