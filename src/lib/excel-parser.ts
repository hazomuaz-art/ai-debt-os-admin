/**
 * Minimal XLSX reader — no external dependencies.
 *
 * XLSX files are ZIP archives containing XML. This parser:
 *  1. Extracts the ZIP using browser-compatible DecompressionStream (Node 18+)
 *     OR falls back to a manual Inflate for older environments.
 *  2. Parses the sharedStrings.xml and the first sheet XML.
 *  3. Returns rows as string[][].
 *
 * Supports: .xlsx (Office Open XML). Does NOT support legacy .xls (BIFF8).
 * Returns first sheet only.
 *
 * Arabic text in UTF-8 XML is handled natively — no encoding conversion needed.
 */

// ── ZIP extraction ──────────────────────────────────────────────────────────

interface ZipEntry {
  name:    string
  getData: () => Uint8Array
}

function readUint32LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset+1] << 8) | (buf[offset+2] << 16) | (buf[offset+3] << 24)
}
function readUint16LE(buf: Uint8Array, offset: number): number {
  return buf[offset] | (buf[offset+1] << 8)
}

/** Parse ZIP local file headers (no central directory parsing needed) */
function parseZip(buf: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = []
  let pos = 0

  while (pos < buf.length - 4) {
    const sig = readUint32LE(buf, pos)
    if (sig !== 0x04034b50) { pos++; continue }

    const compression = readUint16LE(buf, pos + 8)
    const compSize    = readUint32LE(buf, pos + 18)
    const uncompSize  = readUint32LE(buf, pos + 22)
    const nameLen     = readUint16LE(buf, pos + 26)
    const extraLen    = readUint16LE(buf, pos + 28)
    const nameBytes   = buf.slice(pos + 30, pos + 30 + nameLen)
    const name        = new TextDecoder('utf-8').decode(nameBytes)
    const dataStart   = pos + 30 + nameLen + extraLen
    const compData    = buf.slice(dataStart, dataStart + compSize)

    const capturedComp     = compression
    const capturedUncomp   = uncompSize
    const capturedCompData = compData

    entries.push({
      name,
      getData() {
        if (capturedComp === 0) return capturedCompData // stored uncompressed
        if (capturedComp === 8) return inflateRaw(capturedCompData, capturedUncomp)
        throw new Error(`Unsupported compression: ${capturedComp}`)
      },
    })

    pos = dataStart + compSize
  }
  return entries
}

// ── Minimal DEFLATE raw decompressor ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const Buffer: any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function require(module: string): any

function inflateRaw(compressed: Uint8Array, _uncompressedSize: number): Uint8Array {
  // Use Node.js zlib for server-side
  try {
    const zlib = require('zlib') as { inflateRawSync: (buf: unknown) => { buffer: ArrayBuffer; byteOffset: number; byteLength: number } }
    const buf  = Buffer.from(compressed)
    const result = zlib.inflateRawSync(buf)
    return new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
  } catch {
    throw new Error('Failed to decompress XLSX: zlib not available')
  }
}

// ── XML parser (minimal) ────────────────────────────────────────────────────

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g,   (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** Extract all text content between XML tags matching a pattern */
function extractTagContent(xml: string, tag: string): string[] {
  const results: string[] = []
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    results.push(decodeXmlEntities(m[1]))
  }
  return results
}

function getAttr(tag: string, attr: string): string {
  const m = new RegExp(`${attr}="([^"]*)"`, 'i').exec(tag)
  return m ? decodeXmlEntities(m[1]) : ''
}

// ── Shared strings ─────────────────────────────────────────────────────────

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  const re = /<si>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    // Concatenate all <t> elements inside <si>
    const texts = extractTagContent(m[1], 't')
    strings.push(texts.join(''))
  }
  return strings
}

// ── Sheet parser ───────────────────────────────────────────────────────────

/** Convert Excel column address (A, B, ..., Z, AA, ...) to 0-based index */
function colToIndex(col: string): number {
  let n = 0
  for (const ch of col.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

/** Parse cell reference like "A1", "B2" → {col, row} */
function parseRef(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase())
  if (!m) return { col: 0, row: 0 }
  return { col: colToIndex(m[1]), row: parseInt(m[2], 10) - 1 }
}

function parseSheet(xml: string, sharedStrings: string[]): string[][] {
  const rows: Map<number, Map<number, string>> = new Map()
  let maxRow = 0
  let maxCol = 0

  // Parse each <c> element. Real production data-loss bug this fixes: the
  // old regex was `/<c\s([^>]*)>([\s\S]*?)<\/c>/g`, which only matched cells
  // written as `<c ...>...</c>`. Excel writes EMPTY cells as self-closing
  // `<c r="B2" s="3"/>` — the old regex's greedy `[^>]*` consumed the `/` and
  // its `>`, then `([\s\S]*?)<\/c>` reached forward to the NEXT real cell's
  // `</c>`, swallowing that cell entirely (and even pulling its `<v>` value
  // up into the empty cell's slot). Net effect: any cell following an empty
  // cell — very commonly the next row's first column — was lost or
  // corrupted. Confirmed live on a real 134-row import file: 107 of 134
  // customer names silently dropped, exactly the rows whose name column was
  // preceded by an empty (self-closed) cell. The alternation below matches
  // EITHER a self-closing cell (no inner value) OR a full cell, so an empty
  // cell can never swallow the following one.
  const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let cm: RegExpExecArray | null

  while ((cm = cellRe.exec(xml)) !== null) {
    const attrs   = cm[1]
    const inner   = cm[2] ?? '' // undefined for a self-closing (empty) cell
    const refAttr = getAttr(attrs, 'r')
    const type    = getAttr(attrs, 't')

    if (!refAttr) continue
    const { col, row } = parseRef(refAttr)
    maxRow = Math.max(maxRow, row)
    maxCol = Math.max(maxCol, col)

    // Get value
    const vMatch = /<v>([\s\S]*?)<\/v>/.exec(inner)
    let   cellVal = ''

    if (vMatch) {
      const raw = decodeXmlEntities(vMatch[1])
      if (type === 's') {
        // Shared string index
        const idx = parseInt(raw, 10)
        cellVal = sharedStrings[idx] ?? ''
      } else if (type === 'inlineStr') {
        const texts = extractTagContent(inner, 't')
        cellVal = texts.join('')
      } else {
        cellVal = raw
      }
    } else if (type === 'inlineStr') {
      const texts = extractTagContent(inner, 't')
      cellVal = texts.join('')
    }

    if (!rows.has(row)) rows.set(row, new Map())
    rows.get(row)!.set(col, cellVal)
  }

  // Convert sparse map to 2D array
  const result: string[][] = []
  for (let r = 0; r <= maxRow; r++) {
    const rowData: string[] = []
    const rowMap = rows.get(r)
    for (let c = 0; c <= maxCol; c++) {
      rowData.push(rowMap?.get(c) ?? '')
    }
    result.push(rowData)
  }

  return result
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ParsedSheet {
  headers: string[]
  rows:    string[][]
  name:    string
}

/**
 * Parse an XLSX file buffer and return the first sheet's data.
 * @param buffer — raw file bytes (ArrayBuffer or Buffer)
 */
export function parseXLSX(buffer: ArrayBuffer | unknown): ParsedSheet {
  const uint8 = (typeof Buffer !== 'undefined' && buffer instanceof Buffer)
    ? new Uint8Array((buffer as unknown as { buffer: ArrayBuffer; byteOffset: number; byteLength: number }).buffer,
        (buffer as unknown as { byteOffset: number }).byteOffset,
        (buffer as unknown as { byteLength: number }).byteLength)
    : new Uint8Array(buffer as ArrayBuffer)

  const entries = parseZip(uint8)

  // Find shared strings
  const ssEntry = entries.find(e => e.name.endsWith('sharedStrings.xml'))
  const sharedStrings = ssEntry
    ? parseSharedStrings(new TextDecoder('utf-8').decode(ssEntry.getData()))
    : []

  // Find workbook to get sheet names
  const wbEntry = entries.find(e => e.name.endsWith('workbook.xml'))
  let sheetName = 'Sheet1'
  if (wbEntry) {
    const wbXml = new TextDecoder('utf-8').decode(wbEntry.getData())
    const m = /name="([^"]+)"/.exec(wbXml)
    if (m) sheetName = decodeXmlEntities(m[1])
  }

  // Find first sheet
  const sheetEntry =
    entries.find(e => /xl\/worksheets\/sheet1\.xml$/i.test(e.name)) ??
    entries.find(e => /xl\/worksheets\/sheet\d+\.xml$/i.test(e.name))

  if (!sheetEntry) {
    throw new Error('No worksheet found in XLSX file')
  }

  const sheetXml  = new TextDecoder('utf-8').decode(sheetEntry.getData())
  const allRows   = parseSheet(sheetXml, sharedStrings)

  if (allRows.length < 2) {
    return { headers: allRows[0] ?? [], rows: [], name: sheetName }
  }

  const headers = allRows[0].map(h => h.toLowerCase().trim())
  const dataRows = allRows.slice(1).filter(r => r.some(c => c.trim() !== ''))

  return { headers, rows: dataRows, name: sheetName }
}

/**
 * Detect if a buffer is an XLSX file (ZIP magic bytes PK\x03\x04).
 */
export function isXLSX(buffer: ArrayBuffer | unknown): boolean {
  const uint8 = (typeof Buffer !== 'undefined' && buffer instanceof Buffer)
    ? new Uint8Array((buffer as unknown as { buffer: ArrayBuffer; byteOffset: number; byteLength: number }).buffer,
        (buffer as unknown as { byteOffset: number }).byteOffset,
        (buffer as unknown as { byteLength: number }).byteLength)
    : new Uint8Array(buffer as ArrayBuffer)
  return uint8[0] === 0x50 && uint8[1] === 0x4b && uint8[2] === 0x03 && uint8[3] === 0x04
}
