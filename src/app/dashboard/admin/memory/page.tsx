'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AIMemoryEntry } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  pending:       'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  approved:      'bg-green-500/10  text-green-400  border-green-500/20',
  rejected:      'bg-red-500/10    text-red-400    border-red-500/20',
  auto_approved: 'bg-blue-500/10   text-blue-400   border-blue-500/20',
}

const CATEGORY_LABELS: Record<string, string> = {
  payment_promise: 'وعد سداد', objection: 'اعتراض', angry: 'غاضب',
  greeting: 'تحية', escalation: 'تصعيد', general: 'عام',
}

export default function MemoryPage() {
  const [entries,  setEntries]  = useState<AIMemoryEntry[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [filter,   setFilter]   = useState('all')
  const [form, setForm] = useState({ trigger_pattern: '', response_text: '', category: 'general', language: 'ar' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/modules/memory')
      const d = await r.json() as { data?: AIMemoryEntry[] }
      setEntries(d.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    try {
      await fetch('/api/modules/memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, status: 'pending', is_active: false }),
      })
      setShowAdd(false); setForm({ trigger_pattern: '', response_text: '', category: 'general', language: 'ar' })
      await load()
    } finally { setSaving(false) }
  }

  async function toggleEntry(id: string, is_active: boolean, status: string) {
    await fetch('/api/modules/memory', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active, status: is_active ? 'approved' : status }),
    })
    await load()
  }

  const filtered = filter === 'all' ? entries : entries.filter(e => e.status === filter)
  const totalUse = entries.reduce((s, e) => s + (e.use_count ?? 0), 0)
  const avgSuccess = entries.length ? (entries.reduce((s, e) => s + (e.success_rate ?? 0), 0) / entries.length).toFixed(0) : '0'

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">AI Memory</h1>
          <p className="text-[#8b95a7] text-sm mt-0.5">مكتبة الردود الذكية — يرد من الذاكرة بدون OpenAI</p>
        </div>
        <button onClick={() => setShowAdd(p => !p)} className="btn-primary text-sm">
          {showAdd ? 'إلغاء' : '+ إضافة رد'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card"><div className="text-[#8b95a7] text-xs">إجمالي الردود</div>
          <div className="font-display text-2xl font-bold">{entries.length}</div></div>
        <div className="stat-card"><div className="text-[#8b95a7] text-xs">إجمالي الاستخدام</div>
          <div className="font-display text-2xl font-bold text-brand-400">{totalUse}</div></div>
        <div className="stat-card"><div className="text-[#8b95a7] text-xs">متوسط النجاح</div>
          <div className="font-display text-2xl font-bold text-green-400">{avgSuccess}%</div></div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card p-5 space-y-4">
          <div className="font-display font-semibold text-sm">رد جديد</div>
          <div><label className="label">نمط التفعيل (الكلمة / العبارة) *</label>
            <input required className="input text-sm" placeholder="بسدد" value={form.trigger_pattern}
              onChange={e => setForm(p => ({ ...p, trigger_pattern: e.target.value }))} /></div>
          <div><label className="label">نص الرد *</label>
            <textarea required rows={3} className="input text-sm" value={form.response_text}
              onChange={e => setForm(p => ({ ...p, response_text: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">التصنيف</label>
              <select className="input text-sm" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="label">اللغة</label>
              <select className="input text-sm" value={form.language} onChange={e => setForm(p => ({ ...p, language: e.target.value }))}>
                <option value="ar">عربي</option><option value="en">English</option><option value="both">كلاهما</option>
              </select></div>
          </div>
          <p className="text-[#5f6b7e] text-xs">⚠ سيُضاف الرد بحالة "في الانتظار" ويحتاج موافقة قبل التفعيل</p>
          <button type="submit" disabled={saving} className="btn-primary text-sm px-6">
            {saving ? 'جارٍ الحفظ…' : 'إضافة للمراجعة'}
          </button>
        </form>
      )}

      <div className="flex gap-2 flex-wrap">
        {['all','approved','pending','rejected'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-lg text-xs border transition-colors ${filter === s ? 'bg-brand-600/20 text-brand-400 border-brand-500/30' : 'bg-[#222a36] text-[#5f6b7e] border-[#222a36] hover:text-[#8b95a7]'}`}>
            {s === 'all' ? 'الكل' : s === 'approved' ? 'معتمد' : s === 'pending' ? 'انتظار' : 'مرفوض'}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center text-[#8b95a7] py-12">جارٍ التحميل…</div> : (
        <div className="space-y-2">
          {filtered.length === 0 && <div className="card p-10 text-center text-[#8b95a7]">لا توجد ردود في هذه الفئة</div>}
          {filtered.map(entry => (
            <div key={entry.id} className={`card p-4 ${!entry.is_active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono text-sm font-medium">"{entry.trigger_pattern}"</span>
                    <span className={`status-badge text-[10px] ${STATUS_STYLES[entry.status] ?? ''}`}>{entry.status}</span>
                    <span className="bg-[#222a36] text-[#8b95a7] text-[10px] px-1.5 py-0.5 rounded border border-[#222a36]">
                      {CATEGORY_LABELS[entry.category] ?? entry.category}
                    </span>
                  </div>
                  <p className="text-[#8b95a7] text-sm mb-2">{entry.response_text}</p>
                  <div className="flex gap-4 text-[10px] text-[#5f6b7e]">
                    <span>استُخدم {entry.use_count} مرة</span>
                    <span>نجاح {entry.success_rate?.toFixed(0) ?? 0}%</span>
                    {entry.last_used_at && <span>آخر استخدام: {new Date(entry.last_used_at).toLocaleDateString('ar-SA')}</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  {entry.status === 'pending' && (
                    <button onClick={() => void toggleEntry(entry.id, true, 'approved')}
                      className="text-xs px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                      اعتماد
                    </button>
                  )}
                  <button onClick={() => void toggleEntry(entry.id, !entry.is_active, entry.status)}
                    className={`text-xs px-2 py-1 rounded border transition-colors ${entry.is_active ? 'bg-brand-500/10 text-brand-400 border-brand-500/20' : 'bg-[#222a36] text-[#5f6b7e] border-[#222a36]'}`}>
                    {entry.is_active ? 'مفعّل' : 'معطّل'}
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
