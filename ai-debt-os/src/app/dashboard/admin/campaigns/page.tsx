'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Campaign } from '@/types'

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-white/5 text-white/40 border-white/10',
  scheduled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  running:   'bg-green-500/10 text-green-400 border-green-500/20',
  paused:    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  completed: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
}

const TYPE_LABELS: Record<string, string> = {
  overdue_90: 'متأخرين 90 يوم', pre_salary: 'قبل الراتب',
  post_holiday: 'بعد العيد', settlement: 'تسوية',
  reminder: 'تذكير', custom: 'مخصص',
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading,   setLoading]   = useState(true)
  const [showAdd,   setShowAdd]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [form, setForm] = useState({ name: '', campaign_type: 'reminder', message_template: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/modules/campaigns')
      const d = await r.json() as { data?: Campaign[] }
      setCampaigns(d.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    try {
      await fetch('/api/modules/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, status: 'draft', channels: ['whatsapp'] }),
      })
      setShowAdd(false); await load()
    } finally { setSaving(false) }
  }

  const totalCollected = campaigns.reduce((s, c) => s + Number(c.total_collected ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold">Campaign Engine</h1>
          <p className="text-white/40 text-sm mt-0.5">حملات التحصيل الذكية — تُشغَّل فقط في LIVE Mode</p>
        </div>
        <button onClick={() => setShowAdd(p => !p)} className="btn-primary text-sm">
          {showAdd ? 'إلغاء' : '+ حملة جديدة'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card"><div className="text-white/40 text-xs">إجمالي الحملات</div>
          <div className="font-display text-2xl font-bold">{campaigns.length}</div></div>
        <div className="stat-card"><div className="text-white/40 text-xs">نشطة</div>
          <div className="font-display text-2xl font-bold text-green-400">{campaigns.filter(c => c.status === 'running').length}</div></div>
        <div className="stat-card"><div className="text-white/40 text-xs">إجمالي التحصيل</div>
          <div className="font-display text-2xl font-bold text-brand-400">
            {totalCollected.toLocaleString('ar-SA')} ريال
          </div></div>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="card p-5 space-y-4">
          <div className="font-display font-semibold text-sm">حملة جديدة</div>
          <div><label className="label">اسم الحملة *</label>
            <input required className="input text-sm" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
          <div><label className="label">نوع الحملة</label>
            <select className="input text-sm" value={form.campaign_type} onChange={e => setForm(p => ({ ...p, campaign_type: e.target.value }))}>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div><label className="label">نموذج الرسالة</label>
            <textarea rows={3} className="input text-sm" placeholder="نص الرسالة المرسلة للعملاء…" value={form.message_template}
              onChange={e => setForm(p => ({ ...p, message_template: e.target.value }))} /></div>
          <p className="text-white/30 text-xs">⚠ الحملة تُضاف كمسودة ولا تُشغَّل إلا بعد الموافقة وتفعيل LIVE Mode</p>
          <button type="submit" disabled={saving} className="btn-primary text-sm px-6">
            {saving ? 'جارٍ الحفظ…' : 'إنشاء مسودة'}
          </button>
        </form>
      )}

      {loading ? <div className="text-center text-white/40 py-12">جارٍ التحميل…</div> : (
        <div className="space-y-3">
          {campaigns.length === 0 && <div className="card p-10 text-center text-white/40">لا توجد حملات حتى الآن</div>}
          {campaigns.map(camp => (
            <div key={camp.id} className="card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium">{camp.name}</span>
                    <span className={`status-badge text-[10px] ${STATUS_STYLES[camp.status]}`}>{camp.status}</span>
                    <span className="bg-white/5 text-white/40 text-[10px] px-1.5 py-0.5 rounded border border-white/10">
                      {TYPE_LABELS[camp.campaign_type] ?? camp.campaign_type}
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs text-white/40 flex-wrap">
                    <span>الهدف: {camp.target_count}</span>
                    <span>مُرسَل: {camp.sent_count}</span>
                    <span>مدفوع: {camp.payment_count}</span>
                    <span>محصّل: {Number(camp.total_collected).toLocaleString('ar-SA')} ريال</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
