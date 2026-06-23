// Regression test: runs the OLD column-mapping logic and the NEW Import
// Engine against the SAME real files and reports rows/imported/rejected for
// both, so we can prove the new engine never regresses a file that used to
// work, while fixing files that used to fail.
import { readFileSync } from 'fs'
import { parseXLSX, isXLSX } from '../src/lib/excel-parser'
import { parseCSVBuffer } from '../src/lib/csv-parser'
import { analyzeImportFile } from '../src/lib/import-engine'
import { runOldEngine } from './old-engine'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Usage: tsx scripts/regression-test.ts <file1> <file2> ...')
  process.exit(1)
}

for (const filePath of files) {
  console.log(`\n${'='.repeat(70)}`)
  console.log('FILE:', filePath)
  console.log('='.repeat(70))

  let headers: string[], rows: string[][]
  try {
    const raw = readFileSync(filePath)
    const arrayBuf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
    if (filePath.toLowerCase().endsWith('.csv') && !isXLSX(arrayBuf)) {
      const parsed = parseCSVBuffer(arrayBuf)
      headers = parsed.headers; rows = parsed.rows
    } else {
      const parsed = parseXLSX(arrayBuf)
      headers = parsed.headers; rows = parsed.rows
    }
  } catch (e) {
    console.log('  PARSE FAILED:', e instanceof Error ? e.message : e)
    continue
  }

  console.log(`headers: ${headers.length} | data rows: ${rows.length}`)

  // ── OLD engine ──
  const oldResult = runOldEngine(headers, rows)
  console.log('\n--- OLD engine (pre-existing logic) ---')
  console.log(`  imported: ${oldResult.imported} / ${oldResult.totalRows}`)
  console.log(`  rejected: ${oldResult.rejected}`)
  if (Object.keys(oldResult.rejectReasons).length) {
    console.log('  reasons:', JSON.stringify(oldResult.rejectReasons))
    oldResult.sampleRejected.forEach(s => console.log('   e.g.', s))
  }

  // ── NEW engine ──
  const newResult = analyzeImportFile(headers, rows)
  const newImported = newResult.clusters.filter(c => !c.needsMapping).reduce((n, c) => n + c.rowIndices.length, 0)
  const newBlocked = newResult.clusters.filter(c => c.needsMapping).reduce((n, c) => n + c.rowIndices.length, 0)
  console.log('\n--- NEW Import Engine ---')
  console.log(`  clusters detected: ${newResult.clusters.length}`)
  console.log(`  auto-importable: ${newImported} | blocked (needs mapping): ${newBlocked}`)
  for (const c of newResult.clusters) {
    const nameField = c.resolutions.full_name
    console.log(`   cluster#${c.clusterIndex} rows=${c.rowIndices.length} needsMapping=${c.needsMapping}` +
      ` full_name<-${nameField.resolvedHeader ?? '(unresolved)'}` +
      (nameField.resolvedHeader ? ` (${Math.round(nameField.confidence*100)}%)` : ''))
  }

  // ── Comparison verdict ──
  console.log('\n--- VERDICT ---')
  const totalRows = oldResult.totalRows
  if (newImported === oldResult.imported) {
    console.log(`  ✅ SAME import count (${newImported}) — no regression.`)
  } else if (newImported > oldResult.imported) {
    console.log(`  ✅ IMPROVED: old imported ${oldResult.imported}, new auto-imports ${newImported} (+${newImported - oldResult.imported}), ${newBlocked} explicitly held for mapping confirmation (not silently dropped).`)
  } else {
    console.log(`  ⚠️ REGRESSION CANDIDATE: old imported ${oldResult.imported}, new auto-imports ONLY ${newImported}. Needs investigation before deploy.`)
  }
  console.log(`  (total data rows in file: ${totalRows})`)
}
