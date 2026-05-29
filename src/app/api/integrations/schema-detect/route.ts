import { NextRequest, NextResponse } from 'next/server'
import { withAuth, errors } from '@/lib/api'
import { detectSchemaWithAI } from '@/lib/ai-schema-mapper'

export async function POST(req: NextRequest) {
  return withAuth(async () => {
    let body: { columns?: string[]; sample_rows?: Record<string, unknown>[]; project_type?: string }

    try {
      body = await req.json()
    } catch {
      return errors.badRequest('Invalid JSON')
    }

    if (!Array.isArray(body.columns) || body.columns.length === 0) {
      return errors.badRequest('columns required')
    }

    const result = await detectSchemaWithAI({
      source_name: 'manual_schema_test',
      columns: body.columns,
      sample_rows: body.sample_rows ?? [],
      project_type: body.project_type,
    })

    return NextResponse.json({ data: result })
  })
}
