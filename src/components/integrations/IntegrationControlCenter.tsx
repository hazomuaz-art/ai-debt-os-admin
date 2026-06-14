import { AISchemaTest } from './AISchemaTest'

export function IntegrationControlCenter() {
  const health = [
    { label: 'Collection API', status: 'Ready', tone: 'text-green-400' },
    { label: 'WhatsApp Gateway', status: 'Pending setup', tone: 'text-yellow-400' },
    { label: 'Call Center / Voice', status: 'Future ready', tone: 'text-blue-400' },
    { label: 'AI Mapping Engine', status: 'Ready', tone: 'text-green-400' },
  ]

  const syncStats = [
    { label: 'Imported Customers', value: '0' },
    { label: 'Imported Debts', value: '0' },
    { label: 'Detected Projects', value: '0' },
    { label: 'Last Sync', value: 'Never' },
  ]

  const aiStatus = [
    { label: 'Schema Detection', value: 'Enabled' },
    { label: 'Field Mapping', value: 'Ready' },
    { label: 'Status Mapping', value: 'Ready' },
    { label: 'Confidence', value: '--' },
  ]

  const errors = [
    { label: 'Sync Errors', value: '0' },
    { label: 'Webhook Errors', value: '0' },
    { label: 'Rejected Records', value: '0' },
    { label: 'Import Failures', value: '0' },
  ]

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">
          Integration Control Center
        </h2>
        <p className="text-slate-500 text-sm mt-0.5">
          Monitor sync readiness, AI mapping, connection health, and integration errors before enabling live operations.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-3">
            System Health
          </div>
          <div className="space-y-3">
            {health.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-slate-500">{item.label}</span>
                <span className={`text-xs font-medium ${item.tone}`}>{item.status}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-3">
            Sync Status
          </div>
          <div className="grid grid-cols-2 gap-3">
            {syncStats.map((item) => (
              <div key={item.label}>
                <div className="text-slate-400 text-xs">{item.label}</div>
                <div className="font-display text-lg font-bold">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-3">
            AI Detection
          </div>
          <div className="grid grid-cols-2 gap-3">
            {aiStatus.map((item) => (
              <div key={item.label}>
                <div className="text-slate-400 text-xs">{item.label}</div>
                <div className="text-sm font-medium text-slate-600">{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="text-slate-500 text-xs font-medium uppercase tracking-wider mb-3">
            Error Center
          </div>
          <div className="grid grid-cols-2 gap-3">
            {errors.map((item) => (
              <div key={item.label}>
                <div className="text-slate-400 text-xs">{item.label}</div>
                <div className="font-display text-lg font-bold text-slate-600">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4 border-blue-500/20 bg-blue-500/5">
        <div className="text-sm font-medium text-blue-300">
          AI Auto Mapping is available
        </div>
        <p className="text-white/45 text-xs mt-1">
          The system can analyze incoming collection tables, detect fields, classify statuses, and prepare mappings before live sync.
        </p>
      </div>
      <AISchemaTest />
    </div>
  )
}

