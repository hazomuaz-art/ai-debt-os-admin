'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Portfolio, PortfolioCategory } from '@/types'
import { FolderKanban, Search, Plus, CheckCircle2, XCircle, Power, Box, Settings, Smartphone, ShieldCheck, Zap, Briefcase, Building2, Landmark, MoreHorizontal, Activity } from 'lucide-react'

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

const CATEGORY_ICONS: Record<PortfolioCategory, JSX.Element> = {
  telecom: <Smartphone size={14} />,
  insurance: <ShieldCheck size={14} />,
  utility: <Zap size={14} />,
  recruitment: <Briefcase size={14} />,
  government: <Landmark size={14} />,
  finance: <Activity size={14} />,
  agriculture: <Box size={14} />,
  other: <MoreHorizontal size={14} />,
}

const CATEGORY_COLORS: Record<PortfolioCategory, string> = {
  telecom:     'bg-purple-50 text-purple-600 border-purple-200',
  insurance:   'bg-emerald-50 text-emerald-600 border-emerald-200',
  utility:     'bg-blue-50 text-blue-600 border-blue-200',
  recruitment: 'bg-pink-50 text-pink-600 border-pink-200',
  government:  'bg-indigo-50 text-indigo-600 border-indigo-200',
  finance:     'bg-amber-50 text-amber-600 border-amber-200',
  agriculture: 'bg-lime-50 text-lime-600 border-lime-200',
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
      <button onClick={() => setOpen(true)} className="bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2">
        <Plus size={18} /> إضافة محفظة
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-[#0e7a54]/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4 animate-in fade-in" >
      <div className="bg-white border border-slate-100 rounded-2xl w-full max-w-lg shadow-2xl animate-in slide-in-from-bottom-4">
        
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-[#fbfdfd] rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
              <FolderKanban size={20} />
            </div>
            <h2 className="font-bold text-[#0e7a54] text-lg">إضافة محفظة / مشروع جديد</h2>
          </div>
          <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-lg transition-colors">
            <XCircle size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2 ps-2">الاسم (عربي) *</label>
              <input required className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0e7a54]" 
                value={form.name_ar} onChange={e => setForm(p => ({ ...p, name_ar: e.target.value }))} placeholder="موبايلي"  />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2 ps-2">الاسم (إنجليزي) *</label>
              <input required className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0e7a54] text-end" 
                value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Mobily" dir="ltr" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2 ps-2">الرمز القصير *</label>
              <input required className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#0e7a54] text-end" 
                value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="MOB" maxLength={10} dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-2 ps-2">تصنيف المحفظة *</label>
              <select required className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0e7a54]"
                value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value as PortfolioCategory }))}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2 ps-2">اللون المميز للمحفظة</label>
            <div className="flex gap-3 items-center bg-[#e7f6ef] p-2 rounded-xl">
              <input type="color" value={form.color} onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
                className="w-10 h-10 rounded-lg cursor-pointer bg-white border border-slate-200" />
              <span className="text-slate-500 text-sm font-mono font-bold">{form.color}</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2 ps-2">ملاحظات داخلية (اختياري)</label>
            <textarea className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0e7a54]" 
              rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="أي معلومات إضافية عن شروط العقد أو المحفظة..." />
          </div>
          
          {error && <p className="text-rose-500 bg-rose-50 p-3 rounded-lg text-sm font-bold">{error}</p>}
          
          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setOpen(false)} className="flex-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-bold text-sm px-6 py-3 rounded-xl transition-colors">إلغاء</button>
            <button type="submit" disabled={saving} className="flex-1 bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors disabled:opacity-50">
              {saving ? 'جارٍ الحفظ…' : 'حفظ المحفظة'}
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
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#e7f6ef] font-sans text-slate-800" >
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#f6f8fa] text-[#0e7a54] rounded-xl flex items-center justify-center shrink-0">
            <FolderKanban size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#0e7a54] mb-1">المحافظ والمشاريع (Portfolios)</h1>
            <p className="text-slate-500 text-sm">إدارة الشركات والمشاريع المرتبطة بعمليات التحصيل، وتصنيف الديون</p>
          </div>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:flex-none">
            <Search className="absolute end-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input
              type="text"
              className="w-full md:w-64 bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl pe-10 ps-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 placeholder:text-slate-400"
              placeholder="ابحث باسم المحفظة أو الرمز…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <AddPortfolioModal onSaved={load} />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="text-slate-500 text-xs font-bold mb-2">إجمالي المحافظ</div>
          <div className="flex items-end justify-between">
            <div className="font-bold text-3xl text-[#0e7a54] font-mono">{portfolios.length}</div>
            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400"><FolderKanban size={16}/></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="text-slate-500 text-xs font-bold mb-2">محافظ نشطة (Active)</div>
          <div className="flex items-end justify-between">
            <div className="font-bold text-3xl text-emerald-500 font-mono">
              {portfolios.filter(p => p.is_active).length}
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-500"><CheckCircle2 size={16}/></div>
          </div>
        </div>
        {Object.keys(byCategory).slice(0, 2).map((cat, i) => (
          <div key={cat} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="text-slate-500 text-xs font-bold mb-2">قطاع {CATEGORY_LABELS[cat as PortfolioCategory]}</div>
            <div className="flex items-end justify-between">
              <div className="font-bold text-3xl text-blue-500 font-mono">{byCategory[cat].length}</div>
              <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-500">{i === 0 ? <Building2 size={16}/> : <Landmark size={16}/>}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Portfolio grid */}
      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0e7a54]"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
          <div className="w-20 h-20 bg-blue-50 text-blue-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <FolderKanban size={40} />
          </div>
          <div className="font-bold text-xl text-[#0e7a54] mb-2">لا توجد محافظ مطابقة</div>
          <p className="text-slate-500 text-sm">أضف محفظة جديدة للبدء في ربط الديون والعملاء بها.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map(portfolio => (
            <div key={portfolio.id} className={`bg-white rounded-2xl border shadow-sm p-6 transition-all duration-300 hover:shadow-md flex flex-col ${!portfolio.is_active ? 'opacity-60 bg-slate-50/50 border-slate-100' : 'border-slate-100'}`}>
              
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold font-mono shadow-sm"
                    style={{ backgroundColor: portfolio.color + '15', color: portfolio.color, border: `1px solid ${portfolio.color}30` }}>
                    {portfolio.code.slice(0, 3)}
                  </div>
                  <div>
                    <div className="font-bold text-[#0e7a54] text-lg mb-1">{portfolio.name_ar || portfolio.name}</div>
                    {portfolio.name_ar && <div className="text-slate-400 text-xs font-mono" dir="ltr">{portfolio.name}</div>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 mb-6 flex-wrap">
                <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border ${CATEGORY_COLORS[portfolio.category]}`}>
                  {CATEGORY_ICONS[portfolio.category]}
                  {CATEGORY_LABELS[portfolio.category]}
                </span>
                <span className="bg-[#e7f6ef] text-slate-500 text-xs font-bold px-3 py-1.5 rounded-lg font-mono flex items-center gap-1.5">
                  <Settings size={14} /> {portfolio.source_system === 'manual' ? 'يدوي' : portfolio.source_system}
                </span>
              </div>

              {portfolio.notes && (
                <div className="bg-[#fcfdfd] border border-slate-100 rounded-xl p-3 mb-6">
                  <p className="text-slate-500 text-xs font-medium leading-relaxed line-clamp-2">{portfolio.notes}</p>
                </div>
              )}

              <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
                <button
                  onClick={() => toggleActive(portfolio.id, portfolio.is_active)}
                  className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl border transition-colors ${
                    portfolio.is_active
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 group'
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200'
                  }`}
                >
                  <Power size={14} className={portfolio.is_active ? 'group-hover:hidden' : ''} />
                  {portfolio.is_active && <XCircle size={14} className="hidden group-hover:block" />}
                  {portfolio.is_active ? <span className="group-hover:hidden">الحالة: نشط</span> : <span>تفعيل المحفظة</span>}
                  {portfolio.is_active && <span className="hidden group-hover:block">إيقاف المحفظة</span>}
                </button>
                
                <button className="text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 text-xs font-bold px-4 py-2 rounded-xl transition-colors">
                  التفاصيل
                </button>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  )
}
