import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { IntegrationCard } from '@/components/integrations/IntegrationCard'
import type { IntegrationSetting, IntegrationName } from '@/types'

// ── Integration catalogue ─────────────────────────────────────────────────

const INTEGRATIONS: Array<{
  key:         IntegrationName
  label:       string
  description: string
  icon:        string
}> = [
  {
    key:         'rasf_whatsapp',
    label:       'Rasf WhatsApp',
    description: 'Send and receive WhatsApp messages via the Rasf gateway',
    icon:        '💬',
  },
  {
    key:         'tameez_calls',
    label:       'Tameez Calls',
    description: 'Sync call recordings and AI-powered call analysis from Tameez',
    icon:        '📞',
  },
  {
    key:         'collection_api',
    label:       'Collection System API',
    description: 'Bi-directional sync of debts and customers with your collection system',
    icon:        '🔗',
  },
]

// ── Page ─────────────────────────────────────────────────────────────────

export default async function IntegrationsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', user.id)
    .single()

  if (!profile?.company_id || profile.role !== 'admin') redirect('/dashboard/admin')

  // Load existing integration settings (table may not exist yet — handle gracefully)
  const { data: settings, error: settingsErr } = await supabase
    .from('integration_settings')
    .select('*')
    .eq('company_id', profile.company_id)

  // If table doesn't exist yet, show empty state (migration 012 not run yet)
  const tableNotReady = settingsErr?.message?.includes('does not exist') ||
                        settingsErr?.message?.includes('relation') ||
                        settingsErr?.code === '42P01'

  const settingsMap = new Map<IntegrationName, IntegrationSetting>(
    (settings ?? []).map(s => [s.integration_name as IntegrationName, s as IntegrationSetting])
  )

  const enabledCount  = (settings ?? []).filter(s => s.enabled).length
  const errorCount    = (settings ?? []).filter(s => s.last_error && s.enabled).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Integrations</h1>
          <p className="text-white/40 text-sm mt-0.5">
            Connect external services to automate your debt collection workflow
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-white/30">
            {enabledCount}/{INTEGRATIONS.length} enabled
          </span>
          {errorCount > 0 && (
            <span className="status-badge bg-red-500/10 text-red-400 border-red-500/20">
              {errorCount} error{errorCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Migration warning */}
      {tableNotReady && (
        <div className="card p-4 border-yellow-500/20 bg-yellow-500/5">
          <div className="flex items-start gap-3">
            <span className="text-yellow-400 text-lg">⚠</span>
            <div>
              <div className="font-medium text-yellow-400 text-sm">Database migration required</div>
              <p className="text-white/50 text-xs mt-1">
                Run migration <code className="font-mono bg-white/5 px-1 rounded">012_integration_settings.sql</code> in
                your Supabase SQL Editor to enable integration settings storage.
                Until then, settings are not persisted between sessions.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="text-white/40 text-xs font-medium uppercase tracking-wider">Total</div>
          <div className="font-display text-2xl font-bold">{INTEGRATIONS.length}</div>
          <div className="text-white/30 text-xs">available integrations</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs font-medium uppercase tracking-wider">Active</div>
          <div className="font-display text-2xl font-bold text-green-400">{enabledCount}</div>
          <div className="text-white/30 text-xs">currently enabled</div>
        </div>
        <div className="stat-card">
          <div className="text-white/40 text-xs font-medium uppercase tracking-wider">Errors</div>
          <div className={`font-display text-2xl font-bold ${errorCount > 0 ? 'text-red-400' : 'text-white/30'}`}>
            {errorCount}
          </div>
          <div className="text-white/30 text-xs">need attention</div>
        </div>
      </div>

      {/* Integration cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
        {INTEGRATIONS.map(integration => (
          <IntegrationCard
            key={integration.key}
            name={integration.key}
            label={integration.label}
            description={integration.description}
            icon={integration.icon}
            integrationKey={integration.key}
            initial={settingsMap.get(integration.key) ?? null}
          />
        ))}
      </div>

      {/* Docs footer */}
      <div className="card p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">Need help setting up an integration?</div>
          <div className="text-white/40 text-xs mt-0.5">
            Configure credentials in the cards above. Use &quot;Test Connection&quot; to verify before enabling.
          </div>
        </div>
        <a
          href="https://docs.yourdomain.com/integrations"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary text-sm px-4 py-1.5 shrink-0"
        >
          View Docs ↗
        </a>
      </div>
    </div>
  )
}
