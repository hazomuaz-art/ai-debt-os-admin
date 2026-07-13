import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseXLSX, isXLSX } from '@/lib/excel-parser'
import { parseCSVBuffer } from '@/lib/csv-parser'
import { findCompanyProfile, resolveCompanyProfile } from '@/lib/company-import-profiles'
import { analyzeImportFile, type ClusterReport } from '@/lib/import-engine'

/**
 * Read-only diagnostic pass for the generic Import Engine.
 *
 * Parses the file, clusters rows by layout (active-column signature), and
 * resolves a column→field mapping PER CLUSTER using header text + column
 * content + any known company profile + previously-confirmed templates for
 * that exact layout. Writes NOTHING to the database.
 *
 * Returns one report per detected layout/cluster: the resolved mapping (if
 * confident), or the exact field(s) that are ambiguous/missing and the
 * candidate columns for each — so the UI can ask the admin to confirm,
 * ONCE per layout, before any import happens.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles').select('company_id, role').eq('id', user.id).single()
    if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 400 })
    if (!['admin', 'manager'].includes(profile.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })

    const companyKey = (formData.get('company_key') as string | null)?.trim() || null
    const companyProfile = companyKey ? findCompanyProfile(companyKey) : null

    const buf = await file.arrayBuffer()
    const ext = '.' + file.name.split('.').pop()!.toLowerCase()
    let headers: string[]
    let rows: string[][]

    if (ext === '.xlsx' || ext === '.xls' || isXLSX(buf)) {
      const parsed = parseXLSX(buf)
      headers = parsed.headers
      rows = parsed.rows
    } else {
      const parsed = parseCSVBuffer(buf)
      headers = parsed.headers
      rows = parsed.rows
    }

    if (!headers || headers.length === 0)
      return NextResponse.json({ error: 'لم يتم العثور على أعمدة في الملف' }, { status: 400 })

    // Pull any templates already confirmed for this company, keyed by layout
    // signature, so a known layout (even if mixed with a new one) is
    // auto-resolved without asking again.
    const { data: templateRows } = await supabase
      .from('import_mapping_templates')
      .select('signature_hash, field_map')
      .eq('company_id', profile.company_id)

    const savedTemplates: Record<string, Record<string, string>> = {}
    for (const t of templateRows ?? []) {
      savedTemplates[(t as { signature_hash: string }).signature_hash] =
        (t as { field_map: Record<string, string> }).field_map
    }

    const companyColumnAliases = companyProfile?.columnAliases as Record<string, string> | undefined

    const result = analyzeImportFile(headers, rows, {
      companyColumnAliases,
      savedTemplates: savedTemplates as any,
      portfolioLabelForCluster: (cluster) => {
        // Best-effort human label for the diagnostic UI: look for a
        // portfolio-name-shaped value or a company-profile alias match
        // among this cluster's own active columns.
        const portfolioColIdx = headers.findIndex(h => cluster.signature.includes(h) &&
          /محفظة|مشروع|portfolio/i.test(h))
        if (portfolioColIdx === -1) return null
        const sampleRow = cluster.rowIndices[0]
        const val = rows[sampleRow]?.[portfolioColIdx]
        if (!val) return null
        const resolved = resolveCompanyProfile(val)
        return resolved?.nameAr ?? val
      },
    })

    const clusterSummaries = result.clusters.map((c: ClusterReport) => ({
      cluster_index: c.clusterIndex,
      label: c.label,
      row_count: c.rowIndices.length,
      row_numbers: c.rowNumbers,
      signature_hash: c.signatureHash,
      active_columns: c.signature,
      needs_mapping: c.needsMapping,
      resolved_mapping: Object.fromEntries(
        Object.entries(c.resolutions)
          .filter(([, r]) => r.resolvedHeader)
          .map(([field, r]) => [field, { header: r.resolvedHeader, confidence: Math.round(r.confidence * 100) }]),
      ),
      unresolved_fields: c.unresolvedFields.map(field => ({
        field,
        candidates: c.resolutions[field].candidates.slice(0, 5).map(cand => ({
          header: cand.header,
          confidence: Math.round(cand.score * 100),
          header_match: Math.round(cand.headerScore * 100),
          content_match: Math.round(cand.contentScore * 100),
        })),
      })),
    }))

    return NextResponse.json({
      data: {
        total_rows: rows.length,
        cluster_count: result.clusters.length,
        needs_mapping: result.needsAnyMapping,
        clusters: clusterSummaries,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Analyze failed' },
      { status: 500 },
    )
  }
}
