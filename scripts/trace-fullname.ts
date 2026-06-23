// Pure diagnostic trace — NO logic changes. For every data row: which cluster
// it landed in, the EXACT value under the literal header "اسم العميل" (col 0)
// as parsed from the real file, whether that header is part of the cluster's
// active-column signature, what (if anything) the engine resolved full_name
// to, and — for the user's 5 named examples — exactly which header (if any)
// actually holds that name string anywhere in the row.
import { readFileSync } from 'fs'
import { parseXLSX } from '../src/lib/excel-parser'
import { clusterRowsByLayout, resolveClusterMapping } from '../src/lib/import-engine'

const filePath = process.argv[2]
const buf = readFileSync(filePath)
const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const { headers, rows } = parseXLSX(arrayBuf)

const NAME_COL_HEADER = 'اسم العميل'
const nameColIdx = headers.indexOf(NAME_COL_HEADER)
console.log(`"${NAME_COL_HEADER}" is column index: ${nameColIdx} (${nameColIdx === -1 ? 'NOT FOUND IN HEADERS' : 'found'})`)

const clusters = clusterRowsByLayout(headers, rows)
const rowToCluster = new Map<number, number>()
clusters.forEach((c, ci) => c.rowIndices.forEach(r => rowToCluster.set(r, ci)))

const resolvedByCluster = clusters.map(c => resolveClusterMapping(headers, rows, c))

console.log('\n=== PER-ROW TRACE: rows 2-13 (sheet row numbers) ===')
for (let r = 0; r < rows.length; r++) {
  const rowNum = r + 2
  const ci = rowToCluster.get(r)
  const cluster = ci != null ? clusters[ci] : null
  const valueInNameCol = nameColIdx !== -1 ? rows[r][nameColIdx] : '(no such column)'
  const nameColInClusterSignature = cluster ? cluster.signature.includes(NAME_COL_HEADER) : false
  const resolution = ci != null ? resolvedByCluster[ci].resolutions.full_name : null

  console.log(`\nRow ${rowNum}:`)
  console.log(`  cluster index: ${ci}`)
  console.log(`  value under "${NAME_COL_HEADER}" (col ${nameColIdx}): ${JSON.stringify(valueInNameCol)}`)
  console.log(`  is "${NAME_COL_HEADER}" part of this cluster's active-column signature?: ${nameColInClusterSignature}`)
  console.log(`  engine's resolved full_name header for this row's cluster: ${resolution?.resolvedHeader ?? '(none — needs mapping)'}`)
  if (resolution?.resolvedHeader) {
    const colIdx = headers.indexOf(resolution.resolvedHeader)
    console.log(`  -> value engine would use as full_name: ${JSON.stringify(rows[r][colIdx])}`)
  }
}

// Locate the user's 5 named examples anywhere in the raw row, regardless of
// header, to show which header ACTUALLY holds each name.
console.log('\n=== LOCATING THE USER\'S NAMED EXAMPLES IN THE RAW FILE ===')
const examples = ['منى عبدالرحمن القحطاني', 'عبدالله فهد الدوسري', 'ريم سعود المطيري', 'فهد عبدالعزيز السبيعي', 'بندر سالم الحارثي', 'ماجد علي القرني', 'لمى إبراهيم الشمري']
for (const name of examples) {
  let found = false
  for (let r = 0; r < rows.length; r++) {
    const idx = rows[r].indexOf(name)
    if (idx !== -1) {
      found = true
      console.log(`"${name}" -> Row ${r + 2}, ACTUAL header: "${headers[idx]}" (column index ${idx})`)
    }
  }
  if (!found) console.log(`"${name}" -> NOT FOUND anywhere in the file's parsed cell values`)
}
