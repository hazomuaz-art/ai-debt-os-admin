'use client'

import { useState, useEffect, useCallback } from 'react'
import type { CollectionRule } from '@/types'

const ACTION_LABELS: Record<string, string> = {
  skip_ai:          'تجاهل AI',
  use_cached_reply: 'رد محفوظ',
  low_priority:     'أولوية منخفضة',
  high_priority:    'أولوية عالية',
  human_handoff:    'تحويل لبشري',
  auto_settle:      'تسوية تلقائية',
  escalate:         'تصعيد',
  do_nothing:       'لا إجراء',
}

const ACTION_COLORS: Record<string, string> = {
  skip_ai:          'bg-slate-50 text-slate-500',
  use_cached_reply: 'bg-blue-500/10 text-blue-400',
  low_priority:     'bg-yellow-500/10 text-yellow-400',
  high_priority:    'bg-orange-500/10 text-orange-400',
  human_handoff:    'bg-purple-500/10 text-purple-400',
  escalate:         'bg-red-500/10 text-red-400',
  auto_settle:      'bg-green-500/10 text-green-400',
  do_nothing:       'bg-slate-50 text-slate-400',
}

export default function RulesPage() {
  const [rules, setRules]     = useState<CollectionRule[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', condition_field: '', condition_operator: 'eq', condition_value: '', action: 'skip_ai', priority: 50 })
  const [saving, setSaving]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/modules/rules')
      const d = await r.json() as { data?: CollectionRule[] }
      setRules(d.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await fetch('/api/modules/rules', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name, description: form.description,
          condition: { field: form.condition_field, operator: form.condition_operator, value: form.condition_value },
          action: form.action, priority: form.priority,
        }),
      })
      setShowAdd(false)
      await load()
    } finally { setSaving(false) }
  }

  async function toggleRule(id: string, is_active: boolean) {
    await fetch('/api/modules/rules', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_active }),
    })
    await load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Smart Rules Engine</h1>
          <p className="text-slate-500 text-sm mt-0.5">قواعد تحدد متى يُستخدم AI ومتى يُستخدم رد محفوظ</p>
        </div>
        <button onClick={() => setShowAdd(p => !p)} className="btn-primary text-sm">
          {showAdd ? 'إلغاء' : '+ إضافة قاعدة'}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card p-5 space-y-4">
          <div className="font-display font-semibold text-sm mb-1">قاعدة جديدة</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">الاسم *</label>
              <input required className="input text-sm" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><label className="label">الأولوية</label>
              <input type="number" className="input text-sm" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: +e.target.value }))} /></div>
          </div>
          <div><label className="label">الوصف</label>
            <input className="input text-sm" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">الحقل</label>
              <input className="input text-sm" placeholder="debt.status" value={form.condition_field} onChange={e => setForm(p => ({ ...p, condition_field: e.target.value }))} /></div>
            <div><label className="label">المشغّل</label>
              <select className="input text-sm" value={form.condition_operator} onChange={e => setForm(p => ({ ...p, condition_operator: e.target.value }))}>
                <option value="eq">يساوي (eq)</option>
                <option value="neq">لا يساوي (neq)</option>
                <option value="contains">يحتوي</option>
                <option value="gte">أكبر أو يساوي</option>
                <option value="gt">أكبر من</option>
              </select></div>
            <div><label className="label">القيمة</label>
              <input className="input text-sm" placeholder="settled" value={form.condition_value} onChange={e => setForm(p => ({ ...p, condition_value: e.target.value }))} /></div>
          </div>
          <div><label className="label">الإجراء *</label>
            <select required className="input text-sm" value={form.action} onChange={e => setForm(p => ({ ...p, action: e.target.value }))}>
              {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <button type="submit" disabled={saving} className="btn-primary text-sm px-6">
            {saving ? 'جارٍ الحفظ…' : 'حفظ القاعدة'}
          </button>
        </form>
      )}

      {loading ? <div className="text-center text-slate-500 py-12">جارٍ التحميل…</div> : (
        <div className="space-y-2">
          {rules.length === 0 && <div className="card p-10 text-center text-slate-500">لا توجد قواعد حتى الآن</div>}
          {rules.map(rule => (
            <div key={rule.id} className={`card p-4 flex items-start justify-between gap-4 ${!rule.is_active ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-sm">{rule.name}</span>
                  <span className={`status-badge text-[10px] ${ACTION_COLORS[rule.action]}`}>
                    {ACTION_LABELS[rule.action]}
                  </span>
                  <span className="text-slate-400 text-xs">أولوية: {rule.priority}</span>
                </div>
                {rule.description && <p className="text-slate-500 text-xs">{rule.description}</p>}
                <p className="text-slate-400 text-[10px] mt-1 font-mono">
                  {JSON.stringify(rule.condition)}
                </p>
                <p className="text-slate-400 text-[10px] mt-0.5">
                  تفعّل {rule.trigger_count} مرة
                  {rule.last_triggered_at && ` · آخرها: ${new Date(rule.last_triggered_at).toLocaleDateString('ar-SA')}`}
                </p>
              </div>
              <button onClick={() => void toggleRule(rule.id, !rule.is_active)}
                className={`shrink-0 text-xs px-2 py-1 rounded border transition-colors ${
                  rule.is_active
                    ? 'bg-green-500/10 text-green-400 border-green-500/20'
                    : 'bg-slate-50 text-slate-400 border-slate-200'
                }`}>
                {rule.is_active ? 'مفعّل' : 'معطّل'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
