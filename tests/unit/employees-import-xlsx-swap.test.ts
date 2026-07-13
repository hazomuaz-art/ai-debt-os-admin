import { describe, it, expect, vi } from 'vitest'
import * as XLSX from 'xlsx'

vi.mock('@/lib/api', () => ({ withAuth: vi.fn(), errors: {} }))
vi.mock('@/lib/company-import-profiles', () => ({ resolveCompanyProfile: vi.fn(() => null) }))

import { parseSheet } from '@/lib/employees-import-parser'

// Verifies the swap from the vulnerable `xlsx` npm package to this
// codebase's own dependency-free excel-parser.ts (2026-07-05 security fix)
// produces IDENTICAL extraction results to what the old xlsx-based reader
// did - built with a real .xlsx file (generated via `xlsx` itself, which
// remains installed for the low-risk template-write path), not a mock.
describe('employees import - xlsx library swap parity', () => {
  function buildFixture(rows: (string | number)[][]): ArrayBuffer {
    const ws = XLSX.utils.aoa_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    return out as ArrayBuffer
  }

  it('extracts full_name and email correctly from a realistic file', () => {
    const header = ['id', 'الاسم', 'pbx_old', 'pbx_new', 'ext', 'key', 'المشرف', 'الجوال', 'الفرع', 'المسمى', 'المحفظة', 'البريد']
    const row1 = ['1', 'أحمد العتيبي', '', 'srv1', '101', 'k1', 'خالد', '0500000001', 'الرياض', 'محصل ديون', 'موبايلي', 'ahmed@example.com']
    const row2 = ['2', 'سارة القحطاني', '', 'srv2', '102', 'k2', 'خالد', '0500000002', 'جدة', 'مشرف', 'STC', 'sara@example.com']

    const buf = buildFixture([header, row1, row2])
    const parsed = parseSheet(buf)

    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ email: 'ahmed@example.com', full_name: 'أحمد العتيبي', branch: 'الرياض', job_title: 'محصل ديون' })
    expect(parsed[1]).toMatchObject({ email: 'sara@example.com', full_name: 'سارة القحطاني', branch: 'جدة' })
  })

  it('skips rows missing email or full_name', () => {
    const header = ['id', 'name', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'email']
    const validRow = ['1', 'Valid Name', '', '', '', '', '', '', '', '', '', 'valid@example.com']
    const missingEmail = ['2', 'No Email', '', '', '', '', '', '', '', '', '', '']
    const missingName = ['3', '', '', '', '', '', '', '', '', '', '', 'noname@example.com']

    const buf = buildFixture([header, validRow, missingEmail, missingName])
    const parsed = parseSheet(buf)

    expect(parsed).toHaveLength(1)
    expect(parsed[0].email).toBe('valid@example.com')
  })

  it('handles an empty data section without throwing', () => {
    const header = ['id', 'name', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'email']
    const buf = buildFixture([header])
    expect(() => parseSheet(buf)).not.toThrow()
    expect(parseSheet(buf)).toEqual([])
  })
})
