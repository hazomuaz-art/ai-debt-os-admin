import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseXLSX } from '@/lib/excel-parser'

// Regression test for a real production data-loss bug (2026-07): the
// in-house XLSX cell regex didn't handle self-closing empty cells
// (`<c r="B2"/>`, how Excel writes a blank cell). An empty cell caused the
// regex to swallow the FOLLOWING cell — very commonly the next row's first
// column — silently dropping or corrupting it. Confirmed live on a real
// 134-row import file where 107 of 134 customer names vanished, exactly the
// rows whose name column was preceded by a blank cell. Both the debt
// importer and the campaign Excel-upload feature depend on parseXLSX, so
// this class of bug corrupts real imported customer data.
describe('excel-parser — empty cells must not swallow following cells', () => {
  function toArrayBuffer(rows: (string | number | null)[][]): ArrayBuffer {
    // Passing null (not '') makes the `xlsx` writer emit a genuinely absent /
    // self-closing cell, which is exactly the shape that triggered the bug —
    // an empty-string cell would be written with an explicit (harmless) value.
    const ws = XLSX.utils.aoa_to_sheet(rows as any[][])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  }

  it('reads every row name even when preceded by blank cells', () => {
    // Header, then rows where the LAST column is blank (null) — so the next
    // row's first column (the name) is what the old regex would swallow.
    const rows: (string | number | null)[][] = [
      ['name', 'phone', 'note'],
      ['أحمد الأول', '966500000001', null],
      ['محمد الثاني', '966500000002', null],
      ['سالم الثالث', '966500000003', null],
      ['خالد الرابع', '966500000004', null],
    ]
    const parsed = parseXLSX(toArrayBuffer(rows))
    const nameIdx = parsed.headers.indexOf('name')
    const names = parsed.rows.map(r => (r[nameIdx] ?? '').trim())

    expect(parsed.rows).toHaveLength(4)
    expect(names).toEqual(['أحمد الأول', 'محمد الثاني', 'سالم الثالث', 'خالد الرابع'])
  })

  it('keeps a real value that comes right after a blank cell in the same row', () => {
    const rows: (string | number | null)[][] = [
      ['a', 'b', 'c'],
      ['first', null, 'third'], // 'third' must survive despite the blank 'b'
    ]
    const parsed = parseXLSX(toArrayBuffer(rows))
    expect(parsed.rows[0][0]).toBe('first')
    expect(parsed.rows[0][2]).toBe('third')
  })
})
