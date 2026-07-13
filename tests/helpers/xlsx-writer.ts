// Minimal, dependency-free XLSX (OOXML) writer — TEST FIXTURES ONLY.
//
// Root-cause fix (2026-07-13): the `xlsx` npm package has two vulnerabilities
// (Prototype Pollution, ReDoS) with no fix available from the maintainer,
// ever. Its only production call site was already replaced with a CSV export
// (src/components/employees/EmployeeImportPanel.tsx); this replaces its last
// two remaining call sites — both test-only, generating XLSX fixtures to feed
// into our own parser (src/lib/excel-parser.ts) — so the package can be
// removed from package.json entirely instead of just accepted as a
// lower-risk devDependency.
//
// Deliberately narrow: writes exactly what excel-parser.ts's own ZIP reader
// needs (it only parses local file headers, so this produces a single-sheet
// workbook using STORED — uncompressed — ZIP entries, no DEFLATE needed) and
// nothing excel-parser.ts doesn't already handle. Uses inlineStr cells
// (t="inlineStr") instead of a shared-strings table, since the parser
// supports that natively and it avoids needing a second XML part. A null
// cell value is written as a genuinely self-closing `<c r="B2"/>` — the
// exact shape a real Excel file uses for a blank cell, and the specific
// shape excel-parser-empty-cells.test.ts exists to regression-test.

function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (~crc) >>> 0
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function writeUint32LE(arr: number[], v: number) {
  arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
}
function writeUint16LE(arr: number[], v: number) {
  arr.push(v & 0xff, (v >>> 8) & 0xff)
}

/** Build a minimal, spec-valid ZIP (STORED entries only) from named text parts. */
function buildZip(files: { name: string; data: Uint8Array }[]): ArrayBuffer {
  const localParts: number[] = []
  const centralParts: number[] = []
  const offsets: number[] = []

  for (const f of files) {
    offsets.push(localParts.length)
    const nameBytes = utf8(f.name)
    const crc = crc32(f.data)

    // Local file header
    writeUint32LE(localParts, 0x04034b50)
    writeUint16LE(localParts, 20) // version needed
    writeUint16LE(localParts, 0)  // flags
    writeUint16LE(localParts, 0)  // compression = stored
    writeUint16LE(localParts, 0)  // mod time
    writeUint16LE(localParts, 0)  // mod date
    writeUint32LE(localParts, crc)
    writeUint32LE(localParts, f.data.length) // compressed size
    writeUint32LE(localParts, f.data.length) // uncompressed size
    writeUint16LE(localParts, nameBytes.length)
    writeUint16LE(localParts, 0) // extra field length
    for (const b of nameBytes) localParts.push(b)
    for (const b of f.data) localParts.push(b)
  }

  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const nameBytes = utf8(f.name)
    const crc = crc32(f.data)

    writeUint32LE(centralParts, 0x02014b50)
    writeUint16LE(centralParts, 20) // version made by
    writeUint16LE(centralParts, 20) // version needed
    writeUint16LE(centralParts, 0)  // flags
    writeUint16LE(centralParts, 0)  // compression = stored
    writeUint16LE(centralParts, 0)  // mod time
    writeUint16LE(centralParts, 0)  // mod date
    writeUint32LE(centralParts, crc)
    writeUint32LE(centralParts, f.data.length)
    writeUint32LE(centralParts, f.data.length)
    writeUint16LE(centralParts, nameBytes.length)
    writeUint16LE(centralParts, 0) // extra field length
    writeUint16LE(centralParts, 0) // comment length
    writeUint16LE(centralParts, 0) // disk number start
    writeUint16LE(centralParts, 0) // internal attrs
    writeUint32LE(centralParts, 0) // external attrs
    writeUint32LE(centralParts, offsets[i])
    for (const b of nameBytes) centralParts.push(b)
  }

  const centralDirOffset = localParts.length
  const centralDirSize = centralParts.length

  const eocd: number[] = []
  writeUint32LE(eocd, 0x06054b50)
  writeUint16LE(eocd, 0) // disk number
  writeUint16LE(eocd, 0) // disk with central dir
  writeUint16LE(eocd, files.length) // entries on this disk
  writeUint16LE(eocd, files.length) // total entries
  writeUint32LE(eocd, centralDirSize)
  writeUint32LE(eocd, centralDirOffset)
  writeUint16LE(eocd, 0) // comment length

  const all = new Uint8Array(localParts.length + centralParts.length + eocd.length)
  all.set(localParts, 0)
  all.set(centralParts, localParts.length)
  all.set(eocd, localParts.length + centralParts.length)
  return all.buffer
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function colName(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/**
 * Build a minimal single-sheet XLSX file from a grid of rows.
 * A `null` cell is written as a genuinely self-closing, empty cell
 * (matching real Excel output for a blank cell) — everything else is
 * written as an inline string.
 */
export function buildXlsx(rows: (string | number | null)[][]): ArrayBuffer {
  const rowsXml = rows.map((row, r) => {
    const cellsXml = row.map((val, c) => {
      const ref = `${colName(c)}${r + 1}`
      if (val === null || val === undefined) return `<c r="${ref}"/>`
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(val))}</t></is></c>`
    }).join('')
    return `<row r="${r + 1}">${cellsXml}</row>`
  }).join('')

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`

  return buildZip([
    { name: '[Content_Types].xml', data: utf8(contentTypesXml) },
    { name: '_rels/.rels', data: utf8(rootRelsXml) },
    { name: 'xl/workbook.xml', data: utf8(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: utf8(workbookRelsXml) },
    { name: 'xl/worksheets/sheet1.xml', data: utf8(sheetXml) },
  ])
}
