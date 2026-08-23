import { describe, expect, it } from 'vitest'
import { escapeCsvCell, serializeCsv } from '@/lib/csv'

describe('CSV serialization', () => {
  it('escapes commas, quotes, and newlines in one shared implementation', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"')
    expect(escapeCsvCell('a"b')).toBe('"a""b"')
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"')
    expect(escapeCsvCell(null)).toBe('')
  })

  it('serializes headers and rows consistently', () => {
    expect(serializeCsv(['الاسم', 'القيمة'], [['أحمد', 10]])).toBe('الاسم,القيمة\nأحمد,10')
  })
})
