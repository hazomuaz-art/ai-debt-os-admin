'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CostSettings } from '@/types'

interface CostSummary {
  totalCost:   number
  todayCost:   number
  totalTokens: number
  totalOps:    number
  failedOps:   number
}

interface CostRow { name: string; cost: number; ops: number }
interface DailyPoint { date: string; cost: number }
interface CostData {
  summary:     CostSummary
  byProvider:  CostRow[]
  byAction:    CostRow[]
  byPortfolio: CostRow[]
  dailyTrend:  DailyPoint[]
  recent:      Array<{
    provider: string; action_type: string; portfolio_name: string | null
    estimated_cost: number; total_tokens: number; created_at: string; success: boolean
  }>
}

function fmt(n: number, digits = 4) {
  return `$${n.toFixed(digits)}`
}

function Bar({ value, max, color = 'bg-brand-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden flex-1">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  )
}

const PROVIDER_COLORS: Record<string, string> = {
  openai:    'bg-green-500',
  whatsapp:  'bg-emerald-500',
  tameez:    'bg-blue-500',
  rasf:      'bg-purple-500',
  storage:   'bg-yellow-500',
  external:  'bg-orange-500',
  other:     'bg-white/20',
}

// ── Settings panel ────────────────────────────────────────────────────────

function CostSettingsPanel() {
  const [settings, setSettings] = useState<Partial<CostSettings>>({})
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [open, setOpen]         = useState(false)

  useEffect(() => {
    if (!open) return
    fetch('/api/cost/settings')
      .then(r => r.json())
      .then((d: { data?: CostSettings }) => { if (d.data) setSettings(d.data) })
      .catch(() => {})
  }, [open])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch('/api/cost/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof CostSettings, label: string, hint: string) => (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <span className="text-white/30 text-sm">$</span>
        <input
          type="number" step="0.0001" min="0"
          className="input text-sm font-mono w-36"
          value={String(settings[key] ?? '')}
          onChange={e => setSettings(p => ({ ...p, [key]: Number(e.target.value) }))}
          placeholder="0.0000"
        />
        <span className="text-white/30 text-xs">{hint}</span>
      </div>
    </div>
  )

  return (
    <div>
      <button onClick={() => setOpen(p => !p)} className="btn-secondary text-sm">
        ⚙ إعدادات التكلفة
      </button>
      {open && (
        <div className="card p-5 mt-3 space-y-4">
          <div className="font-display font-semibold text-sm border-b border-white/5 pb-3">
            تعديل أسعار التكلفة
          </div>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {field('openai_input_per_1m',   'OpenAI – رموز الإدخال', '/ مليون رمز')}
              {field('openai_output_per_1m',  'OpenAI – رموز الإخراج', '/ مليون رمز')}
              {field('whatsapp_outbound',     'WhatsApp صادر', '/ رسالة')}
              {field('whatsapp_inbound',      'WhatsApp وارد', '/ رسالة')}
              {field('call_analysis_per_min', 'تحليل المكالمات', '/ دقيقة')}
              {field('storage_per_gb',        'التخزين', '/ GB / شهر')}
              {field('external_api_per_call', 'APIs خارجية', '/ طلب')}
            </div>
            <button type="submit" disabled={saving} className="btn-primary text-sm px-6">
              {saved ? '✓ تم الحفظ' : saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function CostCenterPage() {
  const [data, setData]   = useState<CostData | null>(null)
  const [range, setRange] = useState<'today' | 'month' | 'all'>('month')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/cost?range=${range}`)
      const json = await res.json() as { data?: CostData }
      setData(json.data ?? null)
    } finally {
      setLoading(false)
    }
  }, [range])

  useEffect(() => { void load() }, [load])

  const maxProvider  = Math.max(...(data?.byProvider.map(r => r.cost) ?? [0]), 0.000001)
  const maxAction    = Math.max(...(data?.byAction.map(r => r.cost) ?? [0]), 0.000001)
  const maxPortfolio = Math.max(...(data?.byPortfolio.map(r => r.cost) ?? [0]), 0.000001)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">مركز التكلفة</h1>
          <p className="text-white/40 text-sm mt-0.5">
            التكلفة الحقيقية لجميع عمليات AI والـ APIs
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
            {(['today', 'month', 'all'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  range === r ? 'bg-brand-600 text-white' : 'text-white/40 hover:text-white'
                }`}
              >
                {r === 'today' ? 'اليوم' : r === 'month' ? 'الشهر' : 'الكل'}
              </button>
            ))}
          </div>
          <CostSettingsPanel />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-white/40 py-20">جارٍ التحميل…</div>
      ) : !data ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">💰</div>
          <div className="font-display font-semibold mb-2">لا توجد بيانات تكلفة</div>
          <p className="text-white/40 text-sm">ستظهر هنا تكاليف عمليات AI بمجرد البدء باستخدام النظام</p>
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="stat-card">
              <div className="text-white/40 text-xs uppercase tracking-wider">اليوم</div>
              <div className="font-display text-2xl font-bold text-brand-400">{fmt(data.summary.todayCost)}</div>
              <div className="text-white/30 text-xs">دولار</div>
            </div>
            <div className="stat-card col-span-1 sm:col-span-2">
              <div className="text-white/40 text-xs uppercase tracking-wider">
                {range === 'today' ? 'اليوم' : range === 'month' ? 'الشهر' : 'الإجمالي'}
              </div>
              <div className="font-display text-3xl font-bold">{fmt(data.summary.totalCost)}</div>
              <div className="text-white/30 text-xs">دولار</div>
            </div>
            <div className="stat-card">
              <div className="text-white/40 text-xs uppercase tracking-wider">الرموز</div>
              <div className="font-display text-2xl font-bold">{(data.summary.totalTokens / 1000).toFixed(1)}K</div>
              <div className="text-white/30 text-xs">token</div>
            </div>
            <div className="stat-card">
              <div className="text-white/40 text-xs uppercase tracking-wider">العمليات</div>
              <div className="font-display text-2xl font-bold">{data.summary.totalOps}</div>
              <div className="text-white/30 text-xs text-red-400/80">{data.summary.failedOps} فشل</div>
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

            {/* By Provider */}
            <div className="card p-5">
              <h3 className="font-display font-semibold text-sm mb-4">حسب المزود</h3>
              <div className="space-y-3">
                {data.byProvider.map(row => (
                  <div key={row.name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[row.name] ?? 'bg-white/20'}`} />
                        <span className="font-mono">{row.name}</span>
                        <span className="text-white/30">{row.ops} عملية</span>
                      </div>
                      <span className="text-white/60">{fmt(row.cost)}</span>
                    </div>
                    <Bar value={row.cost} max={maxProvider} color={PROVIDER_COLORS[row.name] ?? 'bg-white/20'} />
                  </div>
                ))}
                {data.byProvider.length === 0 && (
                  <p className="text-white/30 text-xs text-center py-4">لا توجد بيانات</p>
                )}
              </div>
            </div>

            {/* By Portfolio */}
            <div className="card p-5">
              <h3 className="font-display font-semibold text-sm mb-4">حسب المحفظة / الشركة</h3>
              <div className="space-y-3">
                {data.byPortfolio.map(row => (
                  <div key={row.name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[120px]">{row.name}</span>
                        <span className="text-white/30 shrink-0">{row.ops}</span>
                      </div>
                      <span className="text-white/60 shrink-0">{fmt(row.cost)}</span>
                    </div>
                    <Bar value={row.cost} max={maxPortfolio} color="bg-brand-500" />
                  </div>
                ))}
                {data.byPortfolio.length === 0 && (
                  <p className="text-white/30 text-xs text-center py-4">لا توجد بيانات</p>
                )}
              </div>
            </div>

            {/* By Action */}
            <div className="card p-5">
              <h3 className="font-display font-semibold text-sm mb-4">حسب نوع العملية</h3>
              <div className="space-y-3">
                {data.byAction.map(row => (
                  <div key={row.name} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono truncate max-w-[130px]">{row.name}</span>
                        <span className="text-white/30 shrink-0">{row.ops}</span>
                      </div>
                      <span className="text-white/60 shrink-0">{fmt(row.cost)}</span>
                    </div>
                    <Bar value={row.cost} max={maxAction} color="bg-purple-500" />
                  </div>
                ))}
                {data.byAction.length === 0 && (
                  <p className="text-white/30 text-xs text-center py-4">لا توجد بيانات</p>
                )}
              </div>
            </div>
          </div>

          {/* Recent operations table */}
          <div className="card p-5">
            <h3 className="font-display font-semibold text-sm mb-4">آخر العمليات</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/30 text-xs border-b border-white/5">
                    <th className="pb-2 pr-4">المزود</th>
                    <th className="pb-2 pr-4">نوع العملية</th>
                    <th className="pb-2 pr-4">المحفظة</th>
                    <th className="pb-2 pr-4">الرموز</th>
                    <th className="pb-2 pr-4">التكلفة</th>
                    <th className="pb-2 pr-4">الحالة</th>
                    <th className="pb-2">التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={i} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${PROVIDER_COLORS[r.provider] ?? 'bg-white/20'}`} />
                          <span className="font-mono text-xs">{r.provider}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-white/60">{r.action_type}</td>
                      <td className="py-2 pr-4 text-white/50 text-xs">{r.portfolio_name ?? '—'}</td>
                      <td className="py-2 pr-4 text-white/50 text-xs">{r.total_tokens?.toLocaleString() ?? '—'}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-brand-400">{fmt(r.estimated_cost, 6)}</td>
                      <td className="py-2 pr-4">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          r.success
                            ? 'bg-green-500/10 text-green-400 border-green-500/20'
                            : 'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}>
                          {r.success ? 'نجح' : 'فشل'}
                        </span>
                      </td>
                      <td className="py-2 text-white/30 text-xs">
                        {new Date(r.created_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                      </td>
                    </tr>
                  ))}
                  {data.recent.length === 0 && (
                    <tr><td colSpan={7} className="py-8 text-center text-white/30 text-xs">لا توجد عمليات مسجلة</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
