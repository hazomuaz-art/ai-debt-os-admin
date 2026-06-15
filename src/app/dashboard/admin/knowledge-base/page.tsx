'use client'

import { useState, useEffect, useCallback } from 'react'
import { BookOpen, Search, Filter, Plus, ChevronDown, ChevronLeft, Power, PowerOff } from 'lucide-react'

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
  policy:            'bg-blue-50 text-blue-600 border-blue-200',
  rule:              'bg-emerald-50 text-emerald-600 border-emerald-200',
  script:            'bg-purple-50 text-purple-600 border-purple-200',
  faq:               'bg-amber-50 text-amber-600 border-amber-200',
  forbidden:         'bg-rose-50 text-rose-600 border-rose-200',
  escalation_criteria: 'bg-orange-50 text-orange-600 border-orange-200',
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
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#e7f6ef] font-sans text-slate-800" >
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#f6f8fa] text-[#0e7a54] rounded-xl flex items-center justify-center shrink-0">
            <BookOpen size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#0e7a54] mb-1">قاعدة المعرفة (Knowledge Base)</h1>
            <p className="text-slate-500 text-sm">إدارة السياسات، القواعد، والسكريبتات المرجعية للذكاء الاصطناعي</p>
          </div>
        </div>
        <button 
          onClick={() => setShowAdd(p => !p)} 
          className="bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2"
        >
          {showAdd ? 'إلغاء الإضافة' : <><Plus size={18} /> إضافة مقالة جديدة</>}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-center justify-between">
          <div>
            <div className="text-slate-500 text-sm font-bold mb-1">إجمالي المقالات</div>
            <div className="text-3xl font-bold text-[#0e7a54]">{entries.length}</div>
          </div>
          <div className="w-12 h-12 bg-slate-50 text-slate-400 rounded-full flex items-center justify-center">
            <BookOpen size={24} />
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-center justify-between">
          <div>
            <div className="text-slate-500 text-sm font-bold mb-1">المقالات النشطة</div>
            <div className="text-3xl font-bold text-emerald-600">
              {entries.filter(e => e.is_active).length}
            </div>
          </div>
          <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center">
            <Power size={24} />
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex items-center justify-between">
          <div>
            <div className="text-slate-500 text-sm font-bold mb-1">إجمالي الفئات</div>
            <div className="text-3xl font-bold text-blue-600">
              {new Set(entries.map(e => e.category)).size}
            </div>
          </div>
          <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center">
            <Filter size={24} />
          </div>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5 animate-in fade-in slide-in-from-top-2">
          <div className="font-bold text-lg text-[#0e7a54] border-b border-slate-100 pb-3">كتابة مقالة / قاعدة جديدة</div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-bold text-slate-500 ps-2">العنوان *</label>
              <input required className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]" 
                value={form.title} placeholder="مثال: سياسة التقسيط المريحة..."
                onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
            </div>

            <div className="space-y-1.5 md:col-span-2">
              <label className="text-sm font-bold text-slate-500 ps-2">المحتوى *</label>
              <textarea required rows={5} className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54] resize-none" 
                value={form.content}
                onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                placeholder="اكتب تفاصيل السياسة أو القاعدة ليقوم الذكاء الاصطناعي بقراءتها عند التفاوض…" />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-500 ps-2">الفئة (Category)</label>
              <select className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]" 
                value={form.category}
                onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {Object.entries(CAT_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-500 ps-2">اللغة (Language)</label>
              <select className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]" 
                value={form.language}
                onChange={e => setForm(p => ({ ...p, language: e.target.value }))}>
                <option value="ar">اللغة العربية</option>
                <option value="en">English</option>
                <option value="both">كلاهما</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button type="submit" disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-8 py-2.5 rounded-xl transition-colors shadow-sm disabled:opacity-50">
              {saving ? 'جارٍ الحفظ…' : 'حفظ المقالة'}
            </button>
          </div>
        </form>
      )}

      {/* Search + filter */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute end-3 top-2.5 text-slate-400" size={18} />
          <input type="text" className="w-full bg-[#e7f6ef] border-none text-[#0e7a54] rounded-xl pe-10 ps-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
            placeholder="البحث في المقالات والقواعد…" value={search}
            onChange={e => setSearch(e.target.value)} />
        </div>
        
        <div className="flex gap-2 flex-wrap justify-end">
          <button onClick={() => setCatFilter('all')}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-colors ${catFilter === 'all' ? 'bg-[#0e7a54] text-white shadow-sm' : 'bg-[#e7f6ef] text-slate-500 hover:bg-slate-200'}`}>
            الكل
          </button>
          {Object.entries(CAT_AR).map(([k, v]) => (
            <button key={k} onClick={() => setCatFilter(k)}
              className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-colors ${catFilter === k ? 'bg-[#0e7a54] text-white shadow-sm' : 'bg-[#e7f6ef] text-slate-500 hover:bg-slate-200'}`}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0e7a54]"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
            <BookOpen size={40} />
          </div>
          <div className="font-bold text-xl text-[#0e7a54] mb-2">
            {entries.length === 0 ? 'قاعدة المعرفة فارغة' : 'لا توجد نتائج مطابقة للبحث'}
          </div>
          <p className="text-slate-500 text-sm">
            {entries.length === 0
              ? 'أضف السياسات والقواعد التي يستخدمها الذكاء الاصطناعي لضمان تفاوض سليم.'
              : 'جرب استخدام كلمات مفتاحية أخرى أو تغيير فلتر الفئات.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map(entry => (
            <div key={entry.id} className={`bg-white rounded-2xl border border-slate-100 shadow-sm transition-all duration-200 ${!entry.is_active ? 'opacity-60 bg-slate-50/50' : 'hover:shadow-md'}`}>
              <div className="p-4 flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 flex-wrap mb-2">
                    <button
                      onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                      className="font-bold text-[#0e7a54] text-base hover:text-blue-600 transition-colors flex items-center gap-2">
                      {expanded === entry.id ? <ChevronDown size={18} className="text-slate-400"/> : <ChevronLeft size={18} className="text-slate-400"/>}
                      {entry.title}
                    </button>
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${CAT_STYLES[entry.category] ?? CAT_STYLES.other}`}>
                      {CAT_AR[entry.category] ?? entry.category}
                    </span>
                    <span className="bg-[#e7f6ef] text-slate-500 text-[10px] font-bold px-2 py-1 rounded-md">
                      {entry.language === 'ar' ? 'العربية' : entry.language === 'en' ? 'English' : 'مزدوج'}
                    </span>
                  </div>
                  
                  {expanded === entry.id && (
                    <div className="mt-4 text-slate-600 text-sm leading-loose whitespace-pre-wrap bg-[#fcfdfd] rounded-xl p-4 border border-slate-100/50 me-6">
                      {entry.content}
                    </div>
                  )}
                  
                  <div className="text-slate-400 text-xs mt-3 font-mono me-7">
                    تمت الإضافة: {new Date(entry.created_at).toLocaleDateString('ar-SA')}
                  </div>
                </div>

                <button onClick={() => void toggle(entry.id, !entry.is_active)}
                  className={`shrink-0 flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl border transition-colors ${
                    entry.is_active
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'
                      : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'
                  }`}>
                  {entry.is_active ? <><Power size={14} /> فعال</> : <><PowerOff size={14} /> معطّل</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
