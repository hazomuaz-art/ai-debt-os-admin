import { createServiceClient } from '@/lib/supabase/server'
import { isCompanyUuid, resolveCompanyFromEnvMap } from '@/lib/tenant-map'

export function buildTenantPhoneFilter(companyId: string, phone: string): string {
  if (!isCompanyUuid(companyId)) throw new Error('Invalid company id for WAHA tenant filter')
  if (!/^\d{7,20}$/.test(phone)) throw new Error('Invalid normalized phone for WAHA tenant filter')
  return [
    `and(company_id.eq.${companyId},whatsapp.eq.${phone})`,
    `and(company_id.eq.${companyId},whatsapp.eq.+${phone})`,
    `and(company_id.eq.${companyId},phone.eq.${phone})`,
    `and(company_id.eq.${companyId},phone.eq.+${phone})`,
  ].join(',')
}

/** Resolve a WAHA session to exactly one tenant, otherwise fail closed. */
export async function resolveWahaSessionCompany(session: string): Promise<string | null> {
  const configured = resolveCompanyFromEnvMap('WAHA_SESSION_COMPANY_MAP', session)
  if (configured) return configured

  const supabase = createServiceClient()
  const [{ data: portfolioRows, error: portfolioError }, { data: integrationRows, error: integrationError }] = await Promise.all([
    supabase
      .from('portfolio_whatsapp_numbers')
      .select('company_id')
      .eq('instance_name', session)
      .eq('is_active', true),
    supabase
      .from('integration_settings')
      .select('company_id, config')
      .eq('integration_name', 'waha')
      .eq('enabled', true),
  ])

  if (portfolioError || integrationError) {
    throw new Error(`Unable to resolve WAHA tenant: ${portfolioError?.message ?? integrationError?.message}`)
  }

  const companies = new Set<string>()
  for (const row of (portfolioRows ?? []) as Array<{ company_id: string }>) companies.add(row.company_id)
  for (const row of (integrationRows ?? []) as Array<{ company_id: string; config: Record<string, unknown> | null }>) {
    if (String(row.config?.session ?? 'default') === session) companies.add(row.company_id)
  }

  return companies.size === 1 ? [...companies][0] : null
}
