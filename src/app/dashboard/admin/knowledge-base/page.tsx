'use client'

import { useState, useEffect, useCallback } from 'react'

interface KBEntry {
  id:         string
  title:      string
  content:    string
  category:   string
  language:   string
  tags?:      string[]
  is_active:  boolean
  created_at: string
}

const CAT_STYLES: Record<string, string> = {
  policy:            'bg-brand-500/10 text-brand-400 border-brand-500/20',
  rule:              'bg-blue-500/10 text-blue-400 border-blue-500/20',
  script:            'bg-purple-500/10 text-purple-400 border-purple-500/20',
  faq:               'bg-green-500/10 text-green-400 border-green-500/20',
  forbidden:         'bg-red-500/10 text-red-400 border-red-500/20',
  escalation_criteria: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  other:             'bg-slate-50 text-slate-500 border-slate-200',
}

const CAT_AR: Record<string, string> = {
  policy: 'سياسة', rule: 'قاعدة', script: 'سكريبت',
  faq: 'أسئلة شائعة', forbidden: 'محظور', escalation_criteria: 'معايير التصعيد', other: 'أخرى',
}

export default function KnowledgeBasePage() {
  const [entries,  setEntries]  = useState<KBEntry[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [search,   setSearch]   = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [form, setForm] = useState({ title: '', content: '', category: 'policy', language: 'ar' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/modules/memory?table=knowledge_base')
      // Fallback: use a dedicated KB endpoint if available, else empty
      const d = await r.json() as { data?: KBEntry[] }
      // For now, fetch from supabase via a direct API
      const r2 = await fetch('/api/modules/alerts?table=knowledge_base')
      // We'll use the actual KB API
      setEntries([])
    } finally { setLoading(false) }
  }, [])

  // Real load from dedicated endpoint
  useEffect(() => {
    const fetchKB = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/modules/kb')
        if (res.ok) {
          const d = await res.json() as { data?: KBEntry[] }
          setEntries(d.data ?? [])
        }
      } catch { /* KB API not yet connected */ }
      finally { setLoading(false) }
    }
    void fetchKB()
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    try {
      const res = await fetch('/api/modules/kb', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, is_active: true }),
      })
      if (res.ok) {
        const d = await res.json() as { data?: KBEntry }
        if (d.data) setEntries(prev => [d.data!, ...prev])
        setShowAdd(false)
        setForm({ title: '', content: '', category: 'policy', language: 'ar' })
      }
    } finally { setSaving(false) }
  }

  async function toggle(id: string, is_active: boolean) {
    await fetch('/api/modules/kb', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active }),
    })
    setEntries(prev => prev.map(e => e.id === id ? { ...e, is_active } : e))
  }

  const filtered = entries.filter(e => {
    const matchSearch = !search || e.title.toLowerCase().includes(search.toLowerCase()) ||
                        e.content.toLowerCase().includes(search.toLowerCase())
    const matchCat   = catFilter === 'all' || e.category === catFilter
    return matchSearch && matchCat
  })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Knowledge Base</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            سياسات وقواعد وسكريبتات يستخدمها AI أثناء الردود والتفاوض
          </p>
        </div>
        <button onClick={() => setShowAdd(p => !p)} className="btn-primary text-sm">
          {showAdd ? 'إلغاء' : '+ إضافة مقالة'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card"><div className="text-slate-500 text-xs">إجمالي</div>
          <div className="font-display text-2xl font-bold">{entries.length}</div></div>
        <div className="stat-card"><div className="text-slate-500 text-xs">نشط</div>
          <div className="font-display text-2xl font-bold text-green-400">
            {entries.filter(e => e.is_active).length}</div></div>
        <div className="stat-card"><div className="text-slate-500 text-xs">فئات</div>
          <div className="font-display text-2xl font-bold">
            {new Set(entries.map(e => e.category)).size}</div></div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="card p-5 space-y-4">
          <div className="font-display font-semibold text-sm">مقالة جديدة</div>
          <div><label className="label">العنوان *</label>
            <input required className="input text-sm" value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
          <div><label className="label">المحتوى *</label>
            <textarea required rows={5} className="input text-sm" value={form.content}
              onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
              placeholder="اكتب السياسة أو القاعدة أو السكريبت هنا…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">الفئة</label>
              <select className="input text-sm" value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {Object.entries(CAT_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="label">اللغة</label>
              <select className="input text-sm" value={form.language}
                onChange={e => setForm(p => ({ ...p, language: e.target.value }))}>
                <option value="ar">عربي</option>
                <option value="en">English</option>
                <option value="both">كلاهما</option>
              </select></div>
          </div>
          <button type="submit" disabled={saving} className="btn-primary text-sm px-6">
            {saving ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
        </form>
      )}

      {/* Search + filter */}
      <div className="flex gap-3 flex-wrap">
        <input type="text" className="input text-sm max-w-xs"
          placeholder="بحث في المقالات…" value={search}
          onChange={e => setSearch(e.target.value)} />
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setCatFilter('all')}
            className={`px-3 py-1 rounded-lg text-xs border transition-colors ${catFilter === 'all' ? 'bg-brand-600/20 text-brand-400 border-brand-500/30' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
            الكل
          </button>
          {Object.entries(CAT_AR).map(([k, v]) => (
            <button key={k} onClick={() => setCatFilter(k)}
              className={`px-3 py-1 rounded-lg text-xs border transition-colors ${catFilter === k ? 'bg-brand-600/20 text-brand-400 border-brand-500/30' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      {loading ? (
        <div className="text-center text-slate-500 py-12">جارٍ التحميل…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-4xl mb-3">📚</div>
          <div className="font-display font-semibold mb-2">
            {entries.length === 0 ? 'قاعدة المعرفة فارغة' : 'لا توجد نتائج'}
          </div>
          <p className="text-slate-500 text-sm">
            {entries.length === 0
              ? 'أضف السياسات والقواعد التي يستخدمها AI عند الرد على العملاء'
              : 'جرّب بحثاً مختلفاً أو فئة أخرى'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(entry => (
            <div key={entry.id} className={`card p-4 ${!entry.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <button
                      onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                      className="font-medium text-sm hover:text-brand-400 transition-colors text-left">
                      {expanded === entry.id ? '▼ ' : '▶ '}{entry.title}
                    </button>
                    <span className={`status-badge text-[10px] ${CAT_STYLES[entry.category] ?? CAT_STYLES.other}`}>
                      {CAT_AR[entry.category] ?? entry.category}
                    </span>
                    <span className="bg-slate-50 text-slate-400 text-[10px] px-1.5 py-0.5 rounded border border-slate-200">
                      {entry.language}
                    </span>
                  </div>
                  {expanded === entry.id && (
                    <div className="mt-3 text-slate-500 text-sm leading-relaxed whitespace-pre-wrap bg-white/3 rounded-lg p-3 border border-slate-200">
                      {entry.content}
                    </div>
                  )}
                  <p className="text-slate-400 text-[10px] mt-1">
                    {new Date(entry.created_at).toLocaleDateString('ar-SA')}
                  </p>
                </div>
                <button onClick={() => void toggle(entry.id, !entry.is_active)}
                  className={`shrink-0 text-xs px-2 py-1 rounded border transition-colors ${
                    entry.is_active
                      ? 'bg-green-500/10 text-green-400 border-green-500/20'
                      : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}>
                  {entry.is_active ? 'نشط' : 'معطّل'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
