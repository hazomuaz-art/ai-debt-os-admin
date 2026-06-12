'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SystemAlert, AlertSeverity } from '@/types'

const SEV: Record<AlertSeverity, string> = {
  info:     'bg-blue-500/10   text-blue-400   border-blue-500/20',
  warning:  'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  error:    'bg-red-500/10    text-red-400    border-red-500/20',
  critical: 'bg-red-700/20    text-red-300    border-red-600/30',
}

const SEV_ICONS: Record<AlertSeverity, string> = {
  info: 'ℹ', warning: '⚠', error: '✗', critical: '🔴',
}

export default function AlertsPage() {
  const [alerts,  setAlerts]  = useState<SystemAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<AlertSeverity | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/modules/alerts')
      const d = await r.json() as { data?: SystemAlert[] }
      setAlerts(d.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function markRead(id: string) {
    await fetch('/api/modules/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_read: true }),
    })
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a))
  }

  async function resolve(id: string) {
    await fetch('/api/modules/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_resolved: true, resolved_at: new Date().toISOString() }),
    })
    await load()
  }

  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.severity === filter)
  const counts = { critical: 0, error: 0, warning: 0, info: 0 } as Record<AlertSeverity, number>
  for (const a of alerts) counts[a.severity] = (counts[a.severity] ?? 0) + 1

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">System Alerts</h1>
          <p className="text-slate-500 text-sm mt-0.5">مراقبة النظام — أخطاء، تحذيرات، تنبيهات</p>
        </div>
        <button onClick={load} className="btn-secondary text-sm">⟳ تحديث</button>
      </div>

      {/* Severity counters */}
      <div className="grid grid-cols-4 gap-3">
        {(['critical','error','warning','info'] as AlertSeverity[]).map(sev => (
          <div key={sev} className={`stat-card border ${SEV[sev].split(' ').slice(2).join(' ')}`}>
            <div className="text-xs opacity-60 uppercase tracking-wider">{sev}</div>
            <div className={`font-display text-2xl font-bold ${SEV[sev].split(' ')[1]}`}>
              {counts[sev] ?? 0}
            </div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {(['all','critical','error','warning','info'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-lg text-xs border transition-colors ${
              filter === s
                ? 'bg-brand-600/20 text-brand-400 border-brand-500/30'
                : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-500'
            }`}>
            {s === 'all' ? `الكل (${alerts.length})` : `${s} (${counts[s] ?? 0})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-slate-500 py-12">جارٍ التحميل…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">✅</div>
          <div className="font-display font-semibold">لا توجد تنبيهات نشطة</div>
          <p className="text-slate-500 text-sm mt-1">النظام يعمل بشكل طبيعي</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(alert => (
            <div key={alert.id}
              className={`card p-4 border ${SEV[alert.severity].split(' ').slice(2).join(' ')} ${alert.is_read ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="text-lg shrink-0 mt-0.5">{SEV_ICONS[alert.severity]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-sm">{alert.title}</span>
                      <span className={`status-badge text-[10px] ${SEV[alert.severity]}`}>
                        {alert.severity}
                      </span>
                      <span className="text-slate-400 text-xs font-mono">{alert.alert_type}</span>
                    </div>
                    {alert.message && (
                      <p className="text-slate-500 text-xs">{alert.message}</p>
                    )}
                    <p className="text-slate-400 text-[10px] mt-1">
                      {new Date(alert.created_at).toLocaleString('ar-SA')}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {!alert.is_read && (
                    <button onClick={() => void markRead(alert.id)}
                      className="text-xs px-2 py-1 rounded bg-slate-50 text-slate-500 border border-slate-200 hover:text-slate-900">
                      قراءة
                    </button>
                  )}
                  <button onClick={() => void resolve(alert.id)}
                    className="text-xs px-2 py-1 rounded bg-slate-50 text-slate-500 border border-slate-200 hover:text-green-400">
                    حل ✓
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
