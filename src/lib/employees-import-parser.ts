import { parseXLSX } from '@/lib/excel-parser'

// Extracted out of src/app/api/employees/import/route.ts (2026-07-13) because
// Next.js's typed-routes checker only allows a route.ts to export HTTP
// handlers (GET/POST/etc.) plus a small set of reserved config names — any
// other export, including this one (needed for direct unit testing), fails
// `tsc --noEmit` once `.next/types` is regenerated fresh. Pre-existing latent
// breakage (masked only by a stale `.next/types` cache) that blocked the
// deploy pipeline's typecheck gate; the parsing logic itself is unchanged.

const COL = {
  fullName: 1, pbxServer: 2, pbxServerNew: 3, pbxExtension: 4, pbxKey: 5,
  supervisor: 6, workPhone: 7, branch: 8, jobTitle: 9, portfolioName: 10, email: 11,
}

export type ParsedRow = {
  email: string
  full_name: string
  branch: string | null
  supervisor_name: string | null
  job_title: string | null
  portfolio_name: string | null
  work_phone: string | null
  pbx_server: string | null
  pbx_extension: string | null
  pbx_connection_key: string | null
}

// Security hardening (2026-07-05): swapped the `xlsx` (SheetJS) npm package
// for this codebase's own dependency-free parser (excel-parser.ts, already
// proven in production for the main debt-import feature). `xlsx` has two
// HIGH-severity vulnerabilities (Prototype Pollution, ReDoS) with NO fix
// available from the maintainer - this was the only place in the app that
// fed genuinely untrusted, user-uploaded file content into it (the other
// usage, in EmployeeImportPanel.tsx, only WRITES a template file from
// trusted internal data, which is a materially different risk profile and
// left unchanged here).
export function parseSheet(buf: ArrayBuffer): ParsedRow[] {
  const { rows } = parseXLSX(buf)
  const out: ParsedRow[] = []
  for (const r of rows) {
    if (!r || !r.length) continue
    const email = String(r[COL.email] ?? '').trim().toLowerCase()
    const full_name = String(r[COL.fullName] ?? '').trim()
    if (!email || !full_name) continue
    out.push({
      email, full_name,
      branch: r[COL.branch] ? String(r[COL.branch]).trim() : null,
      supervisor_name: r[COL.supervisor] ? String(r[COL.supervisor]).trim() : null,
      job_title: r[COL.jobTitle] ? String(r[COL.jobTitle]).trim() : null,
      portfolio_name: r[COL.portfolioName] ? String(r[COL.portfolioName]).trim() : null,
      work_phone: r[COL.workPhone] ? String(r[COL.workPhone]).trim() : null,
      pbx_server: (r[COL.pbxServerNew] ?? r[COL.pbxServer]) ? String(r[COL.pbxServerNew] ?? r[COL.pbxServer]).trim() : null,
      pbx_extension: r[COL.pbxExtension] ? String(r[COL.pbxExtension]).trim() : null,
      pbx_connection_key: r[COL.pbxKey] ? String(r[COL.pbxKey]).trim() : null,
    })
  }
  return out
}
