'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'

export default function AddWhatsAppNumberModal({
  portfolios,
}: {
  portfolios: { id: string; name: string; name_ar: string | null }[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const [form, setForm] = useState({
    portfolio_id: portfolios[0]?.id ?? '',
    display_name: '',
    phone_number: '',
    instance_name: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolio-whatsapp-numbers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`)
      setIsOpen(false)
      setForm({ portfolio_id: portfolios[0]?.id ?? '', display_name: '', phone_number: '', instance_name: '' })
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل إضافة الرقم')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-[#0e7a54] text-white rounded-xl hover:bg-[#0c6647] font-bold text-sm transition-colors"
      >
        <Plus size={16} /> إضافة رقم واتساب
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-[#151a23] rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-[#222a36] flex items-center justify-between bg-[#222a36]">
              <h2 className="text-lg font-bold text-white">إضافة رقم واتساب جديد</h2>
              <button onClick={() => setIsOpen(false)} className="text-[#5f6b7e] hover:text-slate-300">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">المحفظة</label>
                <select
                  required
                  value={form.portfolio_id}
                  onChange={e => setForm({ ...form, portfolio_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg bg-[#0d1117] border-[#222a36] text-white"
                >
                  {portfolios.map(p => (
                    <option key={p.id} value={p.id}>{p.name_ar || p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">اسم مميّز (اختياري)</label>
                <input
                  type="text"
                  value={form.display_name}
                  onChange={e => setForm({ ...form, display_name: e.target.value })}
                  placeholder="مثال: فريق موبايلي - الدقي"
                  className="w-full px-3 py-2 border rounded-lg bg-[#0d1117] border-[#222a36] text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">رقم الجوال</label>
                <input
                  required
                  type="text"
                  value={form.phone_number}
                  onChange={e => setForm({ ...form, phone_number: e.target.value })}
                  placeholder="9665xxxxxxxx"
                  dir="ltr"
                  className="w-full px-3 py-2 border rounded-lg bg-[#0d1117] border-[#222a36] text-white text-end"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-200 mb-1">اسم الجلسة (Session)</label>
                <input
                  required
                  type="text"
                  value={form.instance_name}
                  onChange={e => setForm({ ...form, instance_name: e.target.value.replace(/\s+/g, '_') })}
                  placeholder="mobily_dokki"
                  dir="ltr"
                  className="w-full px-3 py-2 border rounded-lg bg-[#0d1117] border-[#222a36] text-white text-end font-mono"
                />
                <p className="text-[#5f6b7e] text-xs mt-1">معرّف فريد للجلسة، بدون مسافات — يُستخدم داخلياً فقط.</p>
              </div>

              {error && <p className="text-rose-400 text-sm">{error}</p>}

              <div className="pt-2 flex gap-3">
                <button type="button" onClick={() => setIsOpen(false)} className="flex-1 px-4 py-2 border border-[#222a36] text-slate-300 rounded-xl font-bold hover:bg-[#1a212c]">
                  إلغاء
                </button>
                <button type="submit" disabled={saving} className="flex-1 bg-[#0e7a54] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#0c6647] flex items-center justify-center gap-2">
                  {saving ? <Loader2 size={18} className="animate-spin" /> : 'إضافة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
