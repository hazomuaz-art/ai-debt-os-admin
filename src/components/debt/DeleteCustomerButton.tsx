'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { deleteCustomerFullyAction } from '@/lib/actions/debts'

export function DeleteCustomerButton({
  customerId,
  customerName,
}: {
  customerId: string
  customerName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmText, setConfirmText] = useState('')

  async function doDelete() {
    setLoading(true); setError('')
    const r = await deleteCustomerFullyAction(customerId)
    if (r?.error) {
      setError(r.error); setLoading(false)
    } else {
      router.push('/dashboard/admin/debts')
      router.refresh()
    }
  }

  return (
    <>
      <button
        onClick={() => { setOpen(true); setConfirmText(''); setError('') }}
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white border border-rose-500/20 font-bold rounded-xl text-sm transition-colors"
      >
        <Trash2 size={16} /> حذف العميل
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div dir="rtl" className="bg-[#151a23] border border-[#222a36] rounded-2xl w-full max-w-md shadow-2xl">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-rose-500/15 text-rose-400 flex items-center justify-center"><AlertTriangle size={20} /></div>
                <h2 className="font-bold text-lg text-white">حذف العميل نهائياً</h2>
              </div>
              <p className="text-sm text-[#8b95a7] leading-relaxed mb-2">
                سيتم حذف <span className="font-bold text-white">{customerName}</span> وجميع مديونياته وبياناته من النظام نهائياً.
              </p>
              <p className="text-xs text-emerald-400 mb-4">سيتم الاحتفاظ بنسخة احتياطية من المحادثة بشكل منفصل قبل الحذف.</p>
              {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm mb-3">{error}</div>}
              <label className="label">اكتب <span className="text-rose-400 font-mono">حذف</span> للتأكيد</label>
              <input value={confirmText} onChange={e => setConfirmText(e.target.value)} className="input" placeholder="حذف" />
              <div className="flex gap-3 pt-4">
                <button onClick={() => setOpen(false)} className="btn-secondary flex-1">إلغاء</button>
                <button
                  onClick={doDelete}
                  disabled={loading || confirmText.trim() !== 'حذف'}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 bg-rose-500 hover:bg-rose-600 text-white font-bold px-4 py-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} حذف نهائي
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default DeleteCustomerButton
