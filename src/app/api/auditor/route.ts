/**
 * GET /api/auditor
 * Run the AI System Auditor for this company and return the full report.
 *
 * Query params:
 *   safe_fix=true   — apply safe non-destructive fixes
 *
 * The auditor does NOT modify data unless safe_fix=true.
 * Even with safe_fix=true only non-destructive fixes are applied:
 *   - creating missing system_config rows
 *   - enabling module flags
 *   - etc.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api'
import { runAudit } from '@/lib/auditor'

export async function GET(req: NextRequest) {
  return withAuth(
    async (ctx) => {
      const safeFix = req.nextUrl.searchParams.get('safe_fix') === 'true'

      const report = await runAudit(ctx.profile.company_id, safeFix)

      return NextResponse.json({
        success: true,
        report,
        safe_fix_applied: safeFix,
      })
    },
    { requiredRoles: ['admin'] }
  )
}
