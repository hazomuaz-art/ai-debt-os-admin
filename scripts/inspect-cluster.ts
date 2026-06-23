import { readFileSync } from 'fs'
import { parseXLSX } from '../src/lib/excel-parser'
import { clusterRowsByLayout } from '../src/lib/import-engine'

const filePath = process.argv[2]
const buf = readFileSync(filePath)
const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const { headers, rows } = parseXLSX(arrayBuf)
const clusters = clusterRowsByLayout(headers, rows)
clusters.forEach((c, i) => {
  console.log(`\ncluster#${i} rows=${c.rowIndices.length} signature=`, c.signature)
  const r0 = c.rowIndices[0]
  console.log('  sample row:', headers.map((h, idx) => `${h}=${JSON.stringify(rows[r0][idx])}`).filter(s => !s.endsWith('=""')).join(' | '))
})
