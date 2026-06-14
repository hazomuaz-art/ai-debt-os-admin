'use client'

import { useState } from 'react'

type DetectionResult = {
  confidence: number
  field_mapping: Record<string, string>
  status_mapping: Record<string, {
    base_status: string
    custom_status?: string
    meaning_ar?: string
  }>
  detected_project_type?: string
  notes: string[]
}

export function AISchemaTest() {
  const [columnsText, setColumnsText] = useState('رقم الهوية\nاسم العميل\nرقم الجوال\nرقم الحساب\nالمبلغ\nالحالة\nسبب المطالبة')
  const [statusesText, setStatusesText] = useState('تم السداد\nسداد جزئي\nالرقم لا يخص العميل\nرافض السداد\nالمديونية على المستأجر\nعدم وجود رخصة')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function analyze() {
    setLoading(true)
    setError(null)
    setResult(null)

    const columns = columnsText
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)

    const statuses = statusesText
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)

    try {
      const res = await fetch('/api/integrations/schema-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns,
          sample_rows: statuses.length ? [{ الحالة: statuses.join(' | ') }] : [],
        }),
      })

      const json = await res.json()

      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'Schema detection failed')
      }

      setResult(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card p-5 space-y-4 border-blue-500/20 bg-blue-500/5">
      <div>
        <div className="font-display text-lg font-semibold">AI Schema Test</div>
        <p className="text-slate-500 text-sm mt-0.5">
          Paste columns and statuses from any collection system. AI Debt OS will detect fields, project type, and status meanings.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div>
          <label className="label">Columns</label>
          <textarea
            className="input min-h-[160px] text-sm"
            value={columnsText}
            onChange={(e) => setColumnsText(e.target.value)}
          />
        </div>

        <div>
          <label className="label">Statuses / Classifications</label>
          <textarea
            className="input min-h-[160px] text-sm"
            value={statusesText}
            onChange={(e) => setStatusesText(e.target.value)}
          />
        </div>
      </div>

      <button
        onClick={analyze}
        disabled={loading}
        className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
      >
        {loading ? 'Analyzing...' : 'Analyze Schema'}
      </button>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="card p-4">
            <div className="text-slate-500 text-xs uppercase tracking-wider">Confidence</div>
            <div className="font-display text-2xl font-bold text-green-400">
              {Math.round((result.confidence ?? 0) * 100)}%
            </div>
            <div className="text-slate-400 text-xs mt-1">
              Project: {result.detected_project_type ?? 'unknown'}
            </div>
          </div>

          <div className="card p-4 lg:col-span-2">
            <div className="text-slate-500 text-xs uppercase tracking-wider mb-3">Field Mapping</div>
            <div className="space-y-2">
              {Object.entries(result.field_mapping ?? {}).map(([source, target]) => (
                <div key={source} className="flex items-center justify-between gap-3 text-sm border-b border-slate-200 pb-2">
                  <span className="text-slate-500">{source}</span>
                  <span className="font-mono text-blue-300 text-xs">{target}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-4 lg:col-span-3">
            <div className="text-slate-500 text-xs uppercase tracking-wider mb-3">Status Mapping</div>
            {Object.keys(result.status_mapping ?? {}).length === 0 ? (
              <div className="text-white/35 text-sm">No statuses detected yet.</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-3">
                {Object.entries(result.status_mapping).map(([source, info]) => (
                  <div key={source} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <div className="font-medium">{source}</div>
                    <div className="text-sm text-white/45 mt-1">
                      Base: <span className="text-green-300">{info.base_status}</span>
                    </div>
                    {info.custom_status && (
                      <div className="text-sm text-white/45">
                        Custom: <span className="text-blue-300">{info.custom_status}</span>
                      </div>
                    )}
                    {info.meaning_ar && (
                      <div className="text-xs text-white/35 mt-1">{info.meaning_ar}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
