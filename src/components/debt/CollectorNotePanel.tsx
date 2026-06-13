'use client'

import { useState } from 'react'
import { FileText, CalendarClock, Loader2, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function CollectorNotePanel({ 
  debtId, 
  currentNote,
  currentFollowUpDate
}: { 
  debtId: string
  currentNote?: string | null
  currentFollowUpDate?: string | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState(currentNote || '')
  // Format the ISO date to local datetime-local format if exists
  const [followUpDate, setFollowUpDate] = useState(
    currentFollowUpDate ? new Date(currentFollowUpDate).toISOString().slice(0, 16) : ''
  )

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch(`/api/debts/${debtId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'update_note',
          note,
          follow_up_date: followUpDate || null
        })
      })
      if (res.ok) {
        // Optional: show a small toast or success indicator
        router.refresh()
      } else {
        alert('حدث خطأ أثناء حفظ الإفادة')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3 mb-4">
        <FileText className="text-blue-500" size={20} />
        <h2 className="text-lg font-bold text-[#1e3e50]">إفادة المحصل وتاريخ المتابعة</h2>
      </div>

      <form onSubmit={handleSave} className="space-y-5">
        
        {/* Next Call Date */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-500 flex items-center gap-1.5">
            <CalendarClock size={16} /> موعد المكالمة / المتابعة القادمة
          </label>
          <input 
            type="datetime-local" 
            value={followUpDate}
            onChange={e => setFollowUpDate(e.target.value)}
            className="w-full bg-[#f0f4f8] border border-slate-200 text-[#1e3e50] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
          />
        </div>

        {/* Note Textarea */}
        <div className="space-y-2">
          <label className="text-sm font-bold text-slate-500">ملاحظة المتابعة الأخيرة (يقرأها الذكاء الاصطناعي لفهم السياق)</label>
          <textarea 
            rows={5}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="مثال: العميل طلب مهلة ليوم الخميس القادم لتدبير المبلغ..."
            className="w-full bg-[#f0f4f8] border border-slate-200 text-[#1e3e50] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none leading-relaxed" 
          />
        </div>

        <div className="flex justify-end">
          <button 
            type="submit" 
            disabled={loading}
            className="bg-[#1e3e50] hover:bg-slate-800 text-white font-bold py-2.5 px-6 rounded-xl transition-colors text-sm flex justify-center items-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            حفظ البيانات والإفادة
          </button>
        </div>
      </form>
    </div>
  )
}
