'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CostSettings } from '@/types'
import { DollarSign, Settings2, BarChart2, CheckCircle2, AlertTriangle, Zap, Server, Database, Clock, Activity } from 'lucide-react'
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

function Bar({ value, max, color = 'bg-blue-500' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-2 bg-[#222a36] rounded-full overflow-hidden flex-1 shadow-inner">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
    </div>
  )
}

const PROVIDER_COLORS: Record<string, string> = {
  openai:    'bg-emerald-500',
  whatsapp:  'bg-emerald-400',
  tameez:    'bg-blue-500',
  rasf:      'bg-purple-500',
  storage:   'bg-amber-500',
  external:  'bg-orange-500',
  other:     'bg-slate-300',
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
    <div className="bg-[#0d1117] p-3 rounded-xl border border-[#222a36]">
      <label className="block text-xs font-bold text-[#8b95a7] mb-2">{label}</label>
      <div className="flex items-center gap-2">
        <span className="text-[#5f6b7e] text-sm font-bold">$</span>
        <input
          type="number" step="0.0001" min="0"
          className="w-full bg-[#0b0e14] border-none text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#0e7a54]"
          value={String(settings[key] ?? '')}
          onChange={e => setSettings(p => ({ ...p, [key]: Number(e.target.value) }))}
          placeholder="0.0000" dir="ltr"
        />
        <span className="text-[#5f6b7e] text-[10px] font-bold shrink-0">{hint}</span>
      </div>
    </div>
  )

  return (
    <div className="relative">
      <button onClick={() => setOpen(p => !p)} className="bg-[#151a23] hover:bg-[#1a212c] border border-[#222a36] text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2">
        <Settings2 size={18} /> إعدادات التسعير
      </button>
      
      {open && (
        <div className="absolute start-0 top-full mt-2 w-[400px] sm:w-[500px] z-50 bg-[#151a23] border border-[#222a36] rounded-2xl shadow-2xl p-6 animate-in slide-in-from-top-2">
          <div className="font-bold text-lg text-white mb-4 border-b border-[#222a36] pb-3 flex items-center justify-between">
            <span>تعديل أسعار التكلفة للـ API</span>
            <button onClick={() => setOpen(false)} className="text-[#5f6b7e] hover:text-slate-300 font-bold text-sm bg-[#222a36] px-3 py-1 rounded-lg">إغلاق</button>
          </div>
          
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {field('openai_input_per_1m',   'OpenAI – رموز الإدخال', '/ مليون رمز')}
              {field('openai_output_per_1m',  'OpenAI – رموز الإخراج', '/ مليون رمز')}
              {field('whatsapp_outbound',     'WhatsApp صادر', '/ رسالة')}
              {field('whatsapp_inbound',      'WhatsApp وارد', '/ رسالة')}
              {field('call_analysis_per_min', 'تحليل المكالمات الصوتية', '/ دقيقة')}
              {field('storage_per_gb',        'مساحة التخزين', '/ GB شهرياً')}
              {field('external_api_per_call', 'طلبات API خارجية', '/ طلب')}
            </div>
            
            <button type="submit" disabled={saving} className="w-full bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors shadow-sm mt-2 disabled:opacity-50 flex items-center justify-center gap-2">
              {saved ? <><CheckCircle2 size={18}/> تم الحفظ بنجاح</> : saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
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
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0">
            <DollarSign size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">مركز التكلفة (Cost Center)</h1>
            <p className="text-[#8b95a7] text-sm">التكلفة الحقيقية لجميع عمليات الذكاء الاصطناعي واستهلاك واجهات برمجة التطبيقات (APIs)</p>
          </div>
        </div>

        <div className="flex items-center gap-4 relative">
          <div className="flex bg-[#0b0e14] rounded-xl p-1 border border-[#222a36]">
            {(['today', 'month', 'all'] as const).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                  range === r ? 'bg-[#151a23] text-white shadow-sm' : 'text-[#8b95a7] hover:text-slate-200 hover:bg-[#151a23]/50'
                }`}
              >
                {r === 'today' ? 'اليوم' : r === 'month' ? 'هذا الشهر' : 'الكل'}
              </button>
            ))}
          </div>
          <CostSettingsPanel />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0e7a54]"></div>
        </div>
      ) : !data ? (
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-16 text-center">
          <div className="w-20 h-20 bg-[#222a36] text-slate-300 rounded-full flex items-center justify-center mx-auto mb-4">
            <DollarSign size={40} />
          </div>
          <div className="font-bold text-xl text-white mb-2">لا توجد بيانات تكلفة مسجلة حتى الآن</div>
          <p className="text-[#8b95a7] text-sm">ستظهر هنا تكاليف عمليات النظام بمجرد البدء باستخدامه.</p>
        </div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-5 hover:shadow-md transition-shadow">
              <div className="text-[#8b95a7] text-xs font-bold mb-2 flex items-center gap-1.5"><Clock size={14}/> تكلفة اليوم</div>
              <div className="font-bold text-2xl text-blue-600 font-mono" dir="ltr">{fmt(data.summary.todayCost)}</div>
            </div>
            
            <div className="bg-[#0e7a54] rounded-2xl border border-slate-700 shadow-lg p-5 col-span-1 sm:col-span-2 relative overflow-hidden">
              <div className="absolute top-0 start-0 w-32 h-32 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 -translate-y-1/2 -translate-x-1/2"></div>
              <div className="relative z-10">
                <div className="text-blue-200 text-xs font-bold mb-2 flex items-center gap-1.5"><DollarSign size={14}/> إجمالي التكلفة ({range === 'today' ? 'لليوم' : range === 'month' ? 'للشهر' : 'للإجمالي'})</div>
                <div className="font-bold text-4xl text-white font-mono" dir="ltr">{fmt(data.summary.totalCost)}</div>
              </div>
            </div>

            <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-5 hover:shadow-md transition-shadow">
              <div className="text-[#8b95a7] text-xs font-bold mb-2 flex items-center gap-1.5"><Database size={14}/> الرموز المستهلكة (Tokens)</div>
              <div className="font-bold text-2xl text-white font-mono">{(data.summary.totalTokens / 1000).toFixed(1)}K</div>
            </div>

            <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-5 hover:shadow-md transition-shadow">
              <div className="text-[#8b95a7] text-xs font-bold mb-2 flex items-center gap-1.5"><Zap size={14}/> إجمالي العمليات</div>
              <div className="font-bold text-2xl text-white font-mono">{data.summary.totalOps}</div>
              {data.summary.failedOps > 0 && (
                <div className="text-rose-500 text-[10px] font-bold mt-1 bg-rose-50 px-2 py-0.5 rounded-md inline-block">{data.summary.failedOps} عملية فاشلة</div>
              )}
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* By Provider */}
            <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 hover:shadow-md transition-shadow">
              <h3 className="font-bold text-white text-sm mb-6 flex items-center gap-2 border-b border-slate-50 pb-3"><Server size={16} className="text-emerald-500"/> التكلفة حسب المزود</h3>
              <div className="space-y-4">
                {data.byProvider.map(row => (
                  <div key={row.name} className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[row.name] ?? 'bg-slate-300'}`} />
                        <span className="font-mono text-white">{row.name}</span>
                        <span className="text-[#5f6b7e] font-mono px-2 py-0.5 bg-[#222a36] rounded-md">{row.ops} عملية</span>
                      </div>
                      <span className="text-slate-300 font-mono">{fmt(row.cost)}</span>
                    </div>
                    <Bar value={row.cost} max={maxProvider} color={PROVIDER_COLORS[row.name] ?? 'bg-slate-300'} />
                  </div>
                ))}
                {data.byProvider.length === 0 && (
                  <p className="text-[#5f6b7e] text-xs font-bold text-center py-6 bg-[#222a36] rounded-xl">لا توجد بيانات</p>
                )}
              </div>
            </div>

            {/* By Portfolio */}
            <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 hover:shadow-md transition-shadow">
              <h3 className="font-bold text-white text-sm mb-6 flex items-center gap-2 border-b border-slate-50 pb-3"><BarChart2 size={16} className="text-blue-500"/> حسب المحفظة (المشروع)</h3>
              <div className="space-y-4">
                {data.byPortfolio.map(row => (
                  <div key={row.name} className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[120px] text-white">{row.name}</span>
                        <span className="text-[#5f6b7e] font-mono bg-[#222a36] px-2 py-0.5 rounded-md">{row.ops}</span>
                      </div>
                      <span className="text-slate-300 font-mono">{fmt(row.cost)}</span>
                    </div>
                    <Bar value={row.cost} max={maxPortfolio} color="bg-blue-500" />
                  </div>
                ))}
                {data.byPortfolio.length === 0 && (
                  <p className="text-[#5f6b7e] text-xs font-bold text-center py-6 bg-[#222a36] rounded-xl">لا توجد بيانات</p>
                )}
              </div>
            </div>

            {/* By Action */}
            <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 hover:shadow-md transition-shadow">
              <h3 className="font-bold text-white text-sm mb-6 flex items-center gap-2 border-b border-slate-50 pb-3"><Activity size={16} className="text-purple-500"/> حسب نوع العملية</h3>
              <div className="space-y-4">
                {data.byAction.map(row => (
                  <div key={row.name} className="space-y-2">
                    <div className="flex justify-between text-xs font-bold">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-white truncate max-w-[130px]">{row.name}</span>
                        <span className="text-[#5f6b7e] font-mono bg-[#222a36] px-2 py-0.5 rounded-md">{row.ops}</span>
                      </div>
                      <span className="text-slate-300 font-mono">{fmt(row.cost)}</span>
                    </div>
                    <Bar value={row.cost} max={maxAction} color="bg-purple-500" />
                  </div>
                ))}
                {data.byAction.length === 0 && (
                  <p className="text-[#5f6b7e] text-xs font-bold text-center py-6 bg-[#222a36] rounded-xl">لا توجد بيانات</p>
                )}
              </div>
            </div>
          </div>

          {/* Recent operations table */}
          <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6">
            <h3 className="font-bold text-white text-sm mb-4">سجل تفاصيل العمليات الأخيرة</h3>
            <div className="overflow-x-auto border border-[#222a36] rounded-xl">
              <table className="w-full text-sm text-start">
                <thead className="bg-[#0d1117] border-b border-[#222a36] text-[#8b95a7] text-xs font-bold">
                  <tr>
                    <th className="py-3 px-4">المزود</th>
                    <th className="py-3 px-4">نوع العملية</th>
                    <th className="py-3 px-4">المحفظة المرتبطة</th>
                    <th className="py-3 px-4">حجم الرموز (Tokens)</th>
                    <th className="py-3 px-4">التكلفة</th>
                    <th className="py-3 px-4">الحالة</th>
                    <th className="py-3 px-4">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1c2330]">
                  {data.recent.map((r, i) => (
                    <tr key={i} className="hover:bg-[#1a212c] transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[r.provider] ?? 'bg-slate-300'}`} />
                          <span className="font-mono text-xs font-bold text-white">{r.provider}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-[#8b95a7] font-bold">{r.action_type}</td>
                      <td className="py-3 px-4 text-[#8b95a7] text-xs font-bold">{r.portfolio_name ?? '—'}</td>
                      <td className="py-3 px-4 text-[#8b95a7] text-xs font-mono">{r.total_tokens?.toLocaleString() ?? '—'}</td>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-blue-600" dir="ltr">{fmt(r.estimated_cost, 6)}</td>
                      <td className="py-3 px-4">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-md border ${
                          r.success
                            ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                            : 'bg-rose-50 text-rose-600 border-rose-200'
                        }`}>
                          {r.success ? 'نجحت' : 'فشلت'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-[#5f6b7e] text-xs font-mono font-bold" dir="ltr">
                        {new Date(r.created_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                      </td>
                    </tr>
                  ))}
                  {data.recent.length === 0 && (
                    <tr><td colSpan={7} className="py-12 text-center text-[#5f6b7e] text-sm font-bold bg-[#222a36]/50">لا توجد عمليات مسجلة حتى الآن</td></tr>
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
