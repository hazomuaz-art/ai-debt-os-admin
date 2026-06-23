import { describe, it, expect } from 'vitest'
import { clusterRowsByLayout, resolveClusterMapping, analyzeImportFile } from '@/lib/import-engine'

describe('import-engine — clusterRowsByLayout', () => {
  it('groups rows by which columns are non-empty (structural, not positional)', () => {
    const headers = ['name', 'amount', 'sector_a_field', 'sector_b_field']
    const rows = [
      ['Ali',   '1000', 'X', ''],   // sector A shape
      ['Sara',  '2000', 'Y', ''],   // sector A shape
      ['Omar',  '3000', '',  'Z'],  // sector B shape
    ]
    const clusters = clusterRowsByLayout(headers, rows)
    expect(clusters.length).toBe(2)
    const sizes = clusters.map(c => c.rowIndices.length).sort()
    expect(sizes).toEqual([1, 2])
  })

  it('produces one cluster for a uniformly-shaped file', () => {
    const headers = ['name', 'amount']
    const rows = [['A', '1'], ['B', '2'], ['C', '3']]
    expect(clusterRowsByLayout(headers, rows).length).toBe(1)
  })
})

describe('import-engine — resolveClusterMapping (general, content-driven disambiguation)', () => {
  it('resolves full_name unambiguously from a single clear header match', () => {
    const headers = ['اسم العميل', 'الجوال', 'المبلغ']
    const rows = [
      ['أحمد محمد علي', '0501112222', '500'],
      ['سارة عبدالله', '0502223333', '700'],
    ]
    const cluster = clusterRowsByLayout(headers, rows)[0]
    const { resolutions, needsMapping } = resolveClusterMapping(headers, rows, cluster)
    expect(resolutions.full_name.resolvedHeader).toBe('اسم العميل')
    expect(needsMapping).toBe(false)
  })

  it('disambiguates two header-ambiguous "name-ish" columns using CONTENT (uniqueness), not file-specific keywords', () => {
    // Neither header literally says "اسم العميل" — both loosely match the
    // fuzzy "اسم"+"عميل/مالك" rule, but only one column's VALUES look like
    // unique personal names; the other repeats a small status vocabulary.
    const headers = ['اسم المالك', 'تصنيف العميل']
    const rows = [
      ['خالد بن سعد العتيبي', 'نشط'],
      ['منى عبدالرحمن القحطاني', 'نشط'],
      ['تركي حمد العنزي', 'متأخر'],
      ['فهد عبدالعزيز السبيعي', 'نشط'],
    ]
    const cluster = clusterRowsByLayout(headers, rows)[0]
    const { resolutions } = resolveClusterMapping(headers, rows, cluster)
    expect(resolutions.full_name.resolvedHeader).toBe('اسم المالك')
  })

  it('flags a genuine conflict on a REQUIRED field instead of guessing', () => {
    // Two columns score nearly identically for full_name with no content
    // signal to break the tie — must ask, never silently pick one.
    const headers = ['اسم العميل الأساسي', 'اسم العميل الثاني']
    const rows = [['', ''], ['', '']] // empty content -> no disambiguating signal
    const cluster = clusterRowsByLayout(headers, rows)
    // an all-empty row set won't even cluster meaningfully; use non-empty but symmetric data instead
    const headers2 = ['col_a', 'col_b']
    const rows2 = [['زيد بن علي', 'زيد بن علي'], ['هند سعيد', 'هند سعيد']]
    void cluster
    const cluster2 = clusterRowsByLayout(headers2, rows2)[0]
    // Force both headers to fuzzy-match full_name equally by reusing the same
    // generic "اسم"+"عميل" pattern via a synthetic header substitution test:
    const headers3 = ['اسم العميل أ', 'اسم العميل ب']
    const rows3 = [['زيد بن علي محمد', 'زيد بن علي محمد'], ['هند سعيد فهد', 'هند سعيد فهد']]
    const cluster3 = clusterRowsByLayout(headers3, rows3)[0]
    const { resolutions, needsMapping } = resolveClusterMapping(headers3, rows3, cluster3)
    expect(needsMapping).toBe(true)
    expect(resolutions.full_name.needsMapping).toBe(true)
    expect(resolutions.full_name.resolvedHeader).toBeNull()
  })

  it('does NOT block the cluster when an OPTIONAL field is ambiguous', () => {
    const headers = ['اسم العميل', 'المبلغ', 'رقم 1', 'رقم 2']
    const rows = [
      ['أحمد علي', '500', '12345', '67890'],
      ['سارة محمد', '700', '23456', '78901'],
    ]
    const cluster = clusterRowsByLayout(headers, rows)[0]
    const { needsMapping, resolutions } = resolveClusterMapping(headers, rows, cluster)
    expect(resolutions.full_name.resolvedHeader).toBe('اسم العميل')
    // 'رقم 1' / 'رقم 2' have no header signal and weak/ambiguous content for
    // any optional field — they must be left unresolved without blocking.
    expect(needsMapping).toBe(false)
  })

  it('a saved template for this exact layout wins over generic scoring', () => {
    const headers = ['عمود غامض', 'المبلغ']
    const rows = [['لا يشبه اسماً واضحاً', '500']]
    const cluster = clusterRowsByLayout(headers, rows)[0]
    const { resolutions, needsMapping } = resolveClusterMapping(headers, rows, cluster, {
      savedFieldMap: { 'عمود غامض': 'full_name' },
    })
    expect(resolutions.full_name.resolvedHeader).toBe('عمود غامض')
    expect(needsMapping).toBe(false)
  })

  it('a company profile column alias resolves a field generic scoring would miss', () => {
    const headers = ['CUSTOMER_REF_X', 'المبلغ']
    const rows = [['Ahmed Ali', '500']]
    const cluster = clusterRowsByLayout(headers, rows)[0]
    const { resolutions } = resolveClusterMapping(headers, rows, cluster, {
      companyColumnAliases: { 'customer_ref_x': 'full_name' },
    })
    expect(resolutions.full_name.resolvedHeader).toBe('CUSTOMER_REF_X')
  })
})

describe('import-engine — analyzeImportFile (end-to-end, no DB writes)', () => {
  it('reports distinct clusters with independent mappings for a 2-layout file', () => {
    const headers = ['اسم العميل', 'اسم المالك', 'المبلغ', 'sector_a', 'sector_b']
    const rows = [
      ['أحمد علي', '', '500', 'x', ''],      // layout A: name in اسم العميل
      ['سارة محمد', '', '700', 'y', ''],     // layout A
      ['', 'خالد سعد العتيبي', '900', '', 'z'], // layout B: name in اسم المالك
    ]
    const result = analyzeImportFile(headers, rows)
    expect(result.clusters.length).toBe(2)
    const layoutA = result.clusters.find(c => c.signature.includes('sector_a'))!
    const layoutB = result.clusters.find(c => c.signature.includes('sector_b'))!
    expect(layoutA.resolutions.full_name.resolvedHeader).toBe('اسم العميل')
    expect(layoutB.resolutions.full_name.resolvedHeader).toBe('اسم المالك')
  })
})
