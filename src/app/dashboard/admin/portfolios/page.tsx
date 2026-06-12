'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Portfolio, PortfolioCategory } from '@/types'

const CATEGORY_LABELS: Record<PortfolioCategory, string> = {
  telecom:     'اتصالات',
  insurance:   'تأمين',
  utility:     'خدمات',
  recruitment: 'استقدام',
  government:  'حكومي',
  finance:     'مالي',
  agriculture: 'زراعي',
  other:       'أخرى',
}

const CATEGORY_COLORS: Record<PortfolioCategory, string> = {
  telecom:     'bg-purple-500/10 text-purple-400 border-purple-500/20',
  insurance:   'bg-green-500/10 text-green-400 border-green-500/20',
  utility:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
  recruitment: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  government:  'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  finance:     'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  agriculture: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  other:       'bg-slate-50 text-slate-500 border-slate-200',
}

function AddPortfolioModal({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen]       = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [form, setForm]       = useState({
    name: '', name_ar: '', code: '', category: 'other' as PortfolioCategory,
    color: '#6272f1', notes: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const res = await fetch('/api/portfolios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, source_system: 'manual' }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setOpen(false)
      setForm({ name: '', name_ar: '', code: '', category: 'other', color: '#6272f1', notes: '' })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary text-sm">
        + إضافة محفظة
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-md">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display font-semibold text-lg">إضافة محفظة / مشروع</h2>
          <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-900 text-xl">×</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">الاسم (إنجليزي) *</label>
              <input required className="input text-sm" value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Mobily" />
            </div>
            <div>
              <label className="label">الاسم (عربي)</label>
              <input className="input text-sm" value={form.name_ar}
                onChange={e => setForm(p => ({ ...p, name_ar: e.target.value }))}
                placeholder="موبايلي" dir="rtl" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">الرمز *</label>
              <input required className="input text-sm font-mono uppercase" value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                placeholder="MOB" maxLength={10} />
            </div>
            <div>
              <label className="label">التصنيف *</label>
              <select required className="input text-sm"
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value as PortfolioCategory }))}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="label">اللون</label>
            <div className="flex gap-2 items-center">
              <input type="color" value={form.color}
                onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
                className="w-10 h-10 rounded cursor-pointer bg-transparent border border-slate-200" />
              <span className="text-slate-500 text-xs font-mono">{form.color}</span>
            </div>
          </div>
          <div>
            <label className="label">ملاحظات</label>
            <textarea className="input text-sm" rows={2} value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder="أي معلومات إضافية..." />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1 text-sm">إلغاء</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 text-sm">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function PortfoliosPage() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [loading, setLoading]       = useState(true)
  const [search, setSearch]         = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/portfolios')
      const data = await res.json() as { data?: Portfolio[] }
      setPortfolios(data.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const filtered = portfolios.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.name_ar ?? '').includes(search) ||
    p.code.toLowerCase().includes(search.toLowerCase())
  )

  async function toggleActive(id: string, current: boolean) {
    await fetch('/api/portfolios', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active: !current }),
    })
    await load()
  }

  const byCategory = filtered.reduce((acc, p) => {
    if (!acc[p.category]) acc[p.category] = []
    acc[p.category].push(p)
    return acc
  }, {} as Record<string, Portfolio[]>)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">المحافظ والمشاريع</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            إدارة الشركات والمشاريع المرتبطة بعمليات التحصيل
          </p>
        </div>
        <AddPortfolioModal onSaved={load} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="text-slate-500 text-xs uppercase tracking-wider">إجمالي</div>
          <div className="font-display text-2xl font-bold">{portfolios.length}</div>
          <div className="text-slate-400 text-xs">محفظة</div>
        </div>
        <div className="stat-card">
          <div className="text-slate-500 text-xs uppercase tracking-wider">نشطة</div>
          <div className="font-display text-2xl font-bold text-green-400">
            {portfolios.filter(p => p.is_active).length}
          </div>
          <div className="text-slate-400 text-xs">محفظة</div>
        </div>
        {Object.keys(byCategory).slice(0, 2).map(cat => (
          <div key={cat} className="stat-card">
            <div className="text-slate-500 text-xs uppercase tracking-wider">{CATEGORY_LABELS[cat as PortfolioCategory]}</div>
            <div className="font-display text-2xl font-bold">{byCategory[cat].length}</div>
            <div className="text-slate-400 text-xs">مشروع</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <input
        type="text"
        className="input max-w-xs text-sm"
        placeholder="بحث بالاسم أو الرمز…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* Portfolio grid */}
      {loading ? (
        <div className="text-center text-slate-500 py-16">جارٍ التحميل…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">🗂</div>
          <div className="font-display font-semibold mb-2">لا توجد محافظ</div>
          <p className="text-slate-500 text-sm">أضف محفظة جديدة للبدء</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(portfolio => (
            <div key={portfolio.id} className={`card p-4 ${!portfolio.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold font-mono"
                    style={{ backgroundColor: portfolio.color + '30', color: portfolio.color, border: `1px solid ${portfolio.color}40` }}
                  >
                    {portfolio.code.slice(0, 3)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm">{portfolio.name}</div>
                    {portfolio.name_ar && (
                      <div className="text-slate-500 text-xs" dir="rtl">{portfolio.name_ar}</div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => toggleActive(portfolio.id, portfolio.is_active)}
                  className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                    portfolio.is_active
                      ? 'bg-green-500/10 text-green-400 border-green-500/20 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20'
                      : 'bg-slate-50 text-slate-400 border-slate-200 hover:bg-green-500/10 hover:text-green-400 hover:border-green-500/20'
                  }`}
                >
                  {portfolio.is_active ? 'نشط' : 'معطل'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className={`status-badge text-[10px] ${CATEGORY_COLORS[portfolio.category]}`}>
                  {CATEGORY_LABELS[portfolio.category]}
                </span>
                <span className="text-slate-400 text-xs font-mono">{portfolio.source_system}</span>
              </div>

              {portfolio.notes && (
                <p className="text-slate-400 text-xs mt-2 truncate">{portfolio.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
