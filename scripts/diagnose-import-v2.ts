// Diagnostic-only: runs the REAL new Import Engine (clusterRowsByLayout +
// resolveClusterMapping) against a real file, mirroring exactly what
// /api/debts/import/analyze does. Read-only — writes nothing.
import { readFileSync } from 'fs'
import { parseXLSX, isXLSX } from '../src/lib/excel-parser'
import { analyzeImportFile } from '../src/lib/import-engine'

const filePath = process.argv[2]
if (!filePath) { console.error('Usage: tsx scripts/diagnose-import-v2.ts <path>'); process.exit(1) }

const buf = readFileSync(filePath)
const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
console.log('isXLSX:', isXLSX(arrayBuf))

const parsed = parseXLSX(arrayBuf)
console.log('Sheet:', parsed.name, '| rows:', parsed.rows.length, '| headers:', parsed.headers.length)

const result = analyzeImportFile(parsed.headers, parsed.rows, {})

console.log(`\n=== ${result.clusters.length} layout cluster(s) detected ===`)
for (const c of result.clusters) {
  console.log(`\n--- Cluster #${c.clusterIndex} | rows: ${c.rowNumbers.join(', ')} | needsMapping: ${c.needsMapping} ---`)
  console.log('  active columns:', c.signature.join(' | '))
  console.log('  RESOLVED mapping:')
  for (const [field, res] of Object.entries(c.resolutions)) {
    if (res.resolvedHeader) {
      console.log(`    ${field.padEnd(18)} <- "${res.resolvedHeader}"  (confidence ${(res.confidence*100).toFixed(0)}%)`)
    }
  }
  if (c.unresolvedFields.length) {
    console.log('  UNRESOLVED / NEEDS MAPPING:')
    for (const field of c.unresolvedFields) {
      const res = c.resolutions[field]
      console.log(`    ${field}: candidates =`, res.candidates.slice(0, 4).map(cd =>
        `"${cd.header}"(score=${(cd.score*100).toFixed(0)}%, hdr=${(cd.headerScore*100).toFixed(0)}%, content=${(cd.contentScore*100).toFixed(0)}%)`).join(', ') || '(none)')
    }
  }
}

console.log('\n=== SUMMARY ===')
console.log('clusters:', result.clusters.length)
console.log('needsAnyMapping:', result.needsAnyMapping)
const importableRows = result.clusters.filter(c => !c.needsMapping).reduce((n, c) => n + c.rowIndices.length, 0)
const blockedRows = result.clusters.filter(c => c.needsMapping).reduce((n, c) => n + c.rowIndices.length, 0)
console.log('rows that WOULD import now (auto-resolved):', importableRows)
console.log('rows BLOCKED pending mapping confirmation:', blockedRows)
