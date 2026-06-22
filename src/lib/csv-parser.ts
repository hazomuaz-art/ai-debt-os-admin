// Shared CSV parser (extracted from the debts-import route so the read-only
// analyze endpoint can use the exact same parsing logic).

// ── Fix encoding issues (Windows-1256 / CP1256 for Arabic) ─────────────────
function fixEncoding(text: string): string {
  if (/[؀-ۿ]/.test(text)) return text
  return text.replace(/[\x80-\x9F]/g, '').replace(/�/g, '').trim()
}

export function parseCSVBuffer(buf: ArrayBuffer): { headers: string[]; rows: string[][] } {
  const bytes = new Uint8Array(buf)
  let text: string

  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    text = new TextDecoder('utf-8').decode(buf.slice(3))
  } else if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
    text = new TextDecoder('utf-16le').decode(buf.slice(2))
  } else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    text = new TextDecoder('utf-16be').decode(buf.slice(2))
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      try {
        text = new TextDecoder('windows-1256').decode(buf)
      } catch {
        text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
      }
    }
  }

  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  text = text.replace(/\0/g, '')

  const lines = text.trim().split('\n')
  if (lines.length === 0 || text.trim() === '') {
    throw new Error('الملف فارغ تماماً (Empty File).')
  }
  if (lines.length === 1) {
    throw new Error('الملف يحتوي على صف العناوين فقط ولا توجد بيانات عملاء.')
  }

  const firstLine = lines[0]
  const commaCount = (firstLine.match(/,/g) || []).length
  const semiCount = (firstLine.match(/;/g) || []).length
  const tabCount = (firstLine.match(/\t/g) || []).length

  let delimiter = ','
  if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t'
  else if (semiCount > commaCount) delimiter = ';'

  function parseLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === delimiter && !inQuotes) {
        result.push(fixEncoding(current.trim()))
        current = ''
      } else {
        current += ch
      }
    }
    result.push(fixEncoding(current.trim()))
    return result
  }

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().trim())
  const rows = lines.slice(1).filter(l => l.trim()).map(parseLine)
  return { headers, rows }
}
