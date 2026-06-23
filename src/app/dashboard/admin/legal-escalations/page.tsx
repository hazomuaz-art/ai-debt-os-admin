'use client'

import { useState, useEffect, useCallback } from 'react'
import { Scale, AlertTriangle, CheckCircle2, X } from 'lucide-react'

type Escalation = {
  id: string
  escalation_type: string
  reason: string
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
  admin_notes: string | null
  customer: { id: string; full_name: string; phone: string } | null
  debt: { id: string; reference_number: string | null; current_balance: number; currency: string; portfolio: { id: string; name: string; name_ar: string | null } | null } | null
  closed_by_profile: { id: string; full_name: string } | null
}

const TYPE_LABELS: Record<string, string> = {
  legal_threat: 'تهديد/إجراء قانوني',
  lawyer_mention: 'ذكر محامٍ',
  complaint: 'شكوى رسمية',
  fault_dispute: 'اعتراض نسبة خطأ',
  recourse_dispute: 'اعتراض حق رجوع',
  third_party_dispute: 'نزاع طرف ثالث',
  recovered_deduction: 'مراجعة حذف مسترد',
  playbook_mandated: 'تصعيد إلزامي بالسياسة',
}

function CloseModal({ escalation, onClosed }: { escalation: Escalation; onClosed: () => void }) {
  const [open, setOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleClose() {
    setSaving(true); setError('')
    try {
      const res = await fetch(`/api/legal-escalations/${escalation.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_notes: notes || null }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setOpen(false)
      onClosed()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5">
        <CheckCircle2 size={14} /> إغلاق التصعيد
      </button>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[9999] p-4">
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white">إغلاق التصعيد — صلاحية admin/manager فقط</h3>
          <button onClick={() => setOpen(false)}><X size={18} className="text-[#8b95a7]" /></button>
        </div>
        <textarea className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm" rows={3}
          placeholder="ملاحظات الإدارة (اختياري)" value={notes} onChange={e => setNotes(e.target.value)} />
        {error && <p className="text-rose-500 text-sm font-bold">{error}</p>}
        <button onClick={handleClose} disabled={saving} className="w-full bg-[#0e7a54] text-white font-bold py-2.5 rounded-xl disabled:opacity-50">
          {saving ? 'جارٍ الإغلاق…' : 'تأكيد الإغلاق'}
        </button>
      </div>
    </div>
  )
}

export default function LegalEscalationsPage() {
  const [escalations, setEscalations] = useState<Escalation[]>([])
  const [filter, setFilter] = useState<'open' | 'closed' | 'all'>('open')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = filter === 'all' ? '' : `?status=${filter}`
      const res = await fetch(`/api/legal-escalations${qs}`)
      const data = await res.json() as { data?: Escalation[] }
      setEscalations(data.data ?? [])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load() }, [load])

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100">
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between gap-4 mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center"><Scale size={24} /></div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">التصعيدات القانونية</h1>
            <p className="text-[#8b95a7] text-sm">ملفات محوّلة لإدارة الشؤون القانونية — الوكيل لا يتفاوض معها حتى الإغلاق</p>
          </div>
        </div>
        <div className="flex gap-2">
          {(['open', 'closed', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-xs font-bold ${filter === f ? 'bg-[#0e7a54] text-white' : 'bg-[#0d1117] text-[#8b95a7]'}`}>
              {f === 'open' ? 'مفتوحة' : f === 'closed' ? 'مغلقة' : 'الكل'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0e7a54]" /></div>
      ) : escalations.length === 0 ? (
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] p-16 text-center">
          <AlertTriangle className="mx-auto mb-4 text-[#8b95a7]" size={40} />
          <div className="font-bold text-xl text-white">لا توجد تصعيدات</div>
        </div>
      ) : (
        <div className="space-y-3">
          {escalations.map(e => (
            <div key={e.id} className="bg-[#151a23] rounded-2xl border border-[#222a36] p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="bg-rose-50 text-rose-600 text-xs font-bold px-2.5 py-1 rounded-lg">{TYPE_LABELS[e.escalation_type] ?? e.escalation_type}</span>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${e.status === 'open' ? 'bg-amber-50 text-amber-600' : 'bg-[#0d1117] text-[#8b95a7]'}`}>
                      {e.status === 'open' ? 'مفتوح' : 'مغلق'}
                    </span>
                  </div>
                  <div className="text-white font-bold">{e.customer?.full_name ?? '—'} <span className="text-[#5f6b7e] font-mono text-xs">({e.customer?.phone})</span></div>
                  <div className="text-[#8b95a7] text-xs">
                    المحفظة: {e.debt?.portfolio?.name_ar ?? e.debt?.portfolio?.name ?? '—'} · المرجع: {e.debt?.reference_number ?? '—'} · الرصيد: {e.debt?.current_balance} {e.debt?.currency}
                  </div>
                  <div className="text-slate-300 text-sm">{e.reason}</div>
                  <div className="text-[#5f6b7e] text-xs">فُتح: {new Date(e.opened_at).toLocaleString('ar-SA')}</div>
                  {e.status === 'closed' && (
                    <div className="text-[#5f6b7e] text-xs">أُغلق بواسطة: {e.closed_by_profile?.full_name ?? '—'} في {e.closed_at ? new Date(e.closed_at).toLocaleString('ar-SA') : '—'}</div>
                  )}
                  {e.admin_notes && <div className="bg-[#0d1117] rounded-lg p-2 text-xs text-slate-300 mt-1">ملاحظات: {e.admin_notes}</div>}
                </div>
                {e.status === 'open' && <CloseModal escalation={e} onClosed={load} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
