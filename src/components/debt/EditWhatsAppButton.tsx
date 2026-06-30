'use client'

import { useState } from 'react'
import { Pencil, X, Check, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function EditWhatsAppButton({
  customerId,
  currentWhatsapp,
}: {
  customerId: string
  currentWhatsapp?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(currentWhatsapp ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSave() {
    if (!value.trim()) { setError('أدخل رقم الواتساب'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/customers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: customerId, whatsapp: value.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'فشل التحديث'); return }
      setOpen(false)
      router.refresh()
    } catch {
      setError('خطأ في الاتصال')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => { setValue(currentWhatsapp ?? ''); setError(''); setOpen(true) }}
        className="text-[#5f6b7e] hover:text-white transition-colors"
        title="تغيير رقم الواتساب"
      >
        <Pencil size={13} />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1" dir="ltr">
      <input
        autoFocus
        type="tel"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setOpen(false) }}
        placeholder="05xxxxxxxx أو 966xxxxxxxxx"
        className="w-40 bg-[#0d1117] border border-[#10b981]/50 text-slate-100 rounded-lg px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[#10b981]"
      />
      {error && <span className="text-rose-400 text-xs">{error}</span>}
      <button
        onClick={handleSave}
        disabled={loading}
        className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50 transition-colors"
        title="حفظ"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="text-[#5f6b7e] hover:text-white transition-colors"
        title="إلغاء"
      >
        <X size={14} />
      </button>
    </div>
  )
}
