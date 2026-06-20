import { getPortfolioTableConfig, type PortfolioField } from '@/lib/portfolio-data-fields'

function coerce(field: PortfolioField, raw: string): string | number | boolean | null {
  const v = raw.trim()
  if (!v) return null
  if (field.type === 'number') {
    const n = parseFloat(v.replace(/[,، ]/g, ''))
    return isNaN(n) ? null : n
  }
  if (field.type === 'boolean') {
    return /^(true|yes|1|نعم|تم)$/i.test(v)
  }
  if (field.type === 'date') {
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0]
  }
  return v
}

// Builds the customer_data_<table> row payload from a raw header→value map
// (lowercased, trimmed headers), matching each field's headerAliases.
export function buildPortfolioPayload(
  companyKey: string,
  rawByHeader: Record<string, string>,
): { table: string; payload: Record<string, unknown> } | null {
  const config = getPortfolioTableConfig(companyKey)
  if (!config) return null

  const payload: Record<string, unknown> = {}
  for (const field of config.fields) {
    for (const alias of field.headerAliases) {
      const val = rawByHeader[alias.toLowerCase().trim()]
      if (val) {
        const coerced = coerce(field, val)
        if (coerced !== null) payload[field.column] = coerced
        break
      }
    }
  }
  return Object.keys(payload).length > 0 ? { table: config.table, payload } : null
}

// Upserts one row per (customer_id) in the portfolio's data table.
export async function upsertPortfolioCustomerData(
  supabase: any,
  args: {
    companyKey:  string
    companyId:   string
    customerId:  string
    portfolioId: string | null
    payload:     Record<string, unknown>
  },
): Promise<void> {
  const config = getPortfolioTableConfig(args.companyKey)
  if (!config) return

  const { data: existing } = await supabase
    .from(config.table)
    .select('id')
    .eq('customer_id', args.customerId)
    .maybeSingle()

  if (existing) {
    await supabase.from(config.table).update({
      ...args.payload,
      ...(args.portfolioId && { portfolio_id: args.portfolioId }),
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id)
  } else {
    await supabase.from(config.table).insert({
      company_id:  args.companyId,
      customer_id: args.customerId,
      portfolio_id: args.portfolioId,
      ...args.payload,
    })
  }
}
