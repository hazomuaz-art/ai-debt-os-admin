'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Approval } from '@/types'

const PRIORITY_STYLES: Record<string, string> = {
  urgent: 'bg-red-500/10 text-red-400 border-red-500/20',
  high:   'bg-orange-500/10 text-orange-400 border-orange-500/20',
  medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  low:    'bg-slate-50 text-slate-500 border-slate-200',
}

const TYPE_LABELS: Record<string, string> = {
  large_settlement: 'تسوية كبيرة', discount: 'خصم', legal_escalation: 'تصعيد قانوني',
  stop_followup: 'إيقاف متابعة', write_off: 'إعفاء', ai_learning: 'تعلم AI',
  campaign_launch: 'تشغيل حملة', custom: 'مخصص',
}

export default function ApprovalsPage() {
  const [items,   setItems]   = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('pending')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/modules/approvals')
      const d = await r.json() as { data?: Approval[] }
      setItems(d.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function act(id: string, status: 'approved' | 'rejected') {
    await fetch('/api/modules/approvals', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    await load()
  }

  const pending  = items.filter((i: Record<string,unknown>) => i.status === 'pending')
  const filtered = filter === 'all' ? items : items.filter((i: Record<string,unknown>) => i.status === filter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Pending Approvals</h1>
        <p className="text-slate-500 text-sm mt-0.5 ar-text" dir="rtl">عمليات تحتاج موافقة يدوية قبل التنفيذ</p>
      </div>

      {pending.length > 0 && (
        <div className="card p-4 border-yellow-500/20 bg-yellow-500/5 flex items-center gap-3">
          <span className="text-2xl font-display font-bold text-yellow-400">{pending.length}</span>
          <span className="text-yellow-400 text-sm">طلبات في انتظار المراجعة</span>
        </div>
      )}

      <div className="flex gap-2">
        {['all','pending','approved','rejected'].map((s: string) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-lg text-xs border transition-colors ${filter === s ? 'bg-brand-600/20 text-brand-400 border-brand-500/30' : 'bg-slate-50 text-slate-400 border-slate-200'}`}>
            {s === 'all' ? 'الكل' : s === 'pending' ? `انتظار (${pending.length})` : s === 'approved' ? 'موافق' : 'مرفوض'}
          </button>
        ))}
      </div>

      {loading ? <div className="text-center text-slate-500 py-12">جارٍ التحميل…</div> : (
        <div className="space-y-3">
          {filtered.length === 0 && <div className="card p-10 text-center text-slate-500">لا توجد طلبات في هذه الفئة</div>}
          {filtered.map((item: Approval) => (
            <div key={item.id} className="card p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-medium text-sm">{item.title}</span>
                    <span className={`status-badge text-[10px] ${PRIORITY_STYLES[String(item.priority ?? '')]}`}>{item.priority}</span>
                    <span className="bg-slate-50 text-slate-500 text-[10px] px-1.5 py-0.5 rounded border border-slate-200">
                      {TYPE_LABELS[String(item.approval_type ?? '')] ?? String(item.approval_type ?? '')}
                    </span>
                  </div>
                  {item.description && <p className="text-slate-500 text-xs mb-1">{item.description}</p>}
                  <p className="text-slate-400 text-[10px]">
                    {new Date(String(item.created_at ?? '')).toLocaleString('ar-SA')}
                    {item.expires_at && ` · تنتهي: ${new Date(String(item.expires_at ?? '')).toLocaleDateString('ar-SA')}`}
                  </p>
                </div>
                {item.status === 'pending' && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => void act(item.id, 'approved')}
                      className="text-xs px-3 py-1.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                      موافقة
                    </button>
                    <button onClick={() => void act(item.id, 'rejected')}
                      className="text-xs px-3 py-1.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                      رفض
                    </button>
                  </div>
                )}
                {item.status !== 'pending' && (
                  <span className={`text-xs px-2 py-1 rounded border ${item.status === 'approved' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                    {item.status === 'approved' ? '✓ موافق' : '✗ مرفوض'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
