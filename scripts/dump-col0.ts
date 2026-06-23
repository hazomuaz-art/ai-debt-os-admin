import { readFileSync } from 'fs'
import { parseXLSX } from '../src/lib/excel-parser'

const filePath = process.argv[2]
const buf = readFileSync(filePath)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const { headers, rows, name } = parseXLSX(ab)
console.log('sheet name:', name)
console.log('first 5 headers:', JSON.stringify(headers.slice(0, 5)))
console.log('col0 header literal:', JSON.stringify(headers[0]))
console.log()
for (let r = 0; r < rows.length; r++) {
  console.log('Row', r + 2, '-> اسم العميل =', JSON.stringify(rows[r][0]))
}
