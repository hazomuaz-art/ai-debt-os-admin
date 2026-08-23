import { NextResponse } from 'next/server'

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows]
    .map(row => row.map(escapeCsvCell).join(','))
    .join('\n')
}

export function csvDownloadResponse(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): NextResponse {
  // BOM keeps Arabic column names readable when the file is opened in Excel.
  return new NextResponse(`\uFEFF${serializeCsv(headers, rows)}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
