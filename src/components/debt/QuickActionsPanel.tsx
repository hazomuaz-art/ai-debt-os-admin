'use client'

import { useState } from 'react'
import { CalendarClock, ShieldAlert, Handshake, UserCog, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'

export default function QuickActionsPanel({ 
  debtId, 
  currentStatus 
}: { 
  debtId: string
  currentStatus: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  
  // States for Modals
  const [showPromiseModal, setShowPromiseModal] = useState(false)
  const [showDisputeModal, setShowDisputeModal] = useState(false)

  // Promise Form
  const [promiseAmount, setPromiseAmount] = useState('')
  const [promiseDate, setPromiseDate] = useState('')
  
  // Dispute Form
  const [disputeReason, setDisputeReason] = useState('')

  async function handleQuickAction(action: 'follow_up' | 'human_handoff') {
    setLoading(action)
    try {
      const res = await fetch(`/api/debts/${debtId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      if (res.ok) {
        router.refresh()
      } else {
        alert('حدث خطأ أثناء تنفيذ الإجراء')
      }
    } finally {
      setLoading(null)
    }
  }

  async function submitPromise(e: React.FormEvent) {
    e.preventDefault()
    setLoading('promise')
    try {
      const res = await fetch(`/api/debts/${debtId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'promise_to_pay',
          amount: Number(promiseAmount),
          date: promiseDate
        })
      })
      if (res.ok) {
        setShowPromiseModal(false)
        router.refresh()
      } else {
        alert('حدث خطأ أثناء تسجيل الوعد')
      }
    } finally {
      setLoading(null)
    }
  }

  async function submitDispute(e: React.FormEvent) {
    e.preventDefault()
    setLoading('dispute')
    try {
      const res = await fetch(`/api/debts/${debtId}/actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'dispute',
          reason: disputeReason
        })
      })
      if (res.ok) {
        setShowDisputeModal(false)
        router.refresh()
      } else {
        alert('حدث خطأ أثناء تسجيل الاعتراض')
      }
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
      <h2 className="text-sm font-bold text-slate-500 mb-4">إجراءات سريعة (Quick Actions)</h2>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Promise to Pay */}
        <button 
          onClick={() => setShowPromiseModal(true)}
          className="flex flex-col items-center justify-center p-4 rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors gap-2"
        >
          <Handshake size={24} />
          <span className="text-xs font-bold">وعد بالسداد</span>
        </button>

        {/* Follow Up */}
        <button 
          onClick={() => handleQuickAction('follow_up')}
          disabled={loading === 'follow_up'}
          className="flex flex-col items-center justify-center p-4 rounded-xl border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors gap-2 disabled:opacity-50"
        >
          {loading === 'follow_up' ? <Loader2 size={24} className="animate-spin" /> : <CalendarClock size={24} />}
          <span className="text-xs font-bold">إضافة للمتابعة</span>
        </button>

        {/* Dispute */}
        <button 
          onClick={() => setShowDisputeModal(true)}
          className="flex flex-col items-center justify-center p-4 rounded-xl border border-rose-100 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors gap-2"
        >
          <ShieldAlert size={24} />
          <span className="text-xs font-bold">اعتراض / مراجعة</span>
        </button>

        {/* Human Handoff */}
        <button 
          onClick={() => handleQuickAction('human_handoff')}
          disabled={loading === 'human_handoff' || currentStatus === 'human_handoff'}
          className="flex flex-col items-center justify-center p-4 rounded-xl border border-amber-100 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors gap-2 disabled:opacity-50 relative overflow-hidden"
        >
          {loading === 'human_handoff' ? <Loader2 size={24} className="animate-spin" /> : <UserCog size={24} />}
          <span className="text-xs font-bold">تدخل بشري مباشر</span>
          {currentStatus === 'human_handoff' && (
             <div className="absolute top-0 right-0 bg-amber-500 text-white text-[8px] font-bold px-2 py-0.5 rounded-bl-lg">نشط حالياً</div>
          )}
        </button>
      </div>

      {/* Promise Modal */}
      {showPromiseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1e3e50]/40 backdrop-blur-sm animate-in fade-in">
          <form onSubmit={submitPromise} className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h3 className="font-bold text-[#1e3e50] text-lg mb-4 flex items-center gap-2">
              <Handshake className="text-emerald-500" />
              تسجيل وعد بالسداد
            </h3>
            
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-500">تاريخ الوعد</label>
              <input 
                type="date" 
                required
                value={promiseDate}
                onChange={e => setPromiseDate(e.target.value)}
                className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" 
              />
            </div>
            
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-500">المبلغ المتفق عليه (SAR)</label>
              <input 
                type="number" 
                required
                min={1}
                value={promiseAmount}
                onChange={e => setPromiseAmount(e.target.value)}
                className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none" 
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button 
                type="button" 
                onClick={() => setShowPromiseModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-colors text-sm"
              >
                إلغاء
              </button>
              <button 
                type="submit" 
                disabled={loading === 'promise'}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors text-sm flex justify-center items-center"
              >
                {loading === 'promise' ? <Loader2 size={16} className="animate-spin" /> : 'حفظ الوعد'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Dispute Modal */}
      {showDisputeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1e3e50]/40 backdrop-blur-sm animate-in fade-in">
          <form onSubmit={submitDispute} className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl space-y-4">
            <h3 className="font-bold text-[#1e3e50] text-lg mb-4 flex items-center gap-2">
              <ShieldAlert className="text-rose-500" />
              تسجيل اعتراض (Dispute)
            </h3>
            
            <p className="text-xs text-rose-600 bg-rose-50 p-3 rounded-lg mb-4">
              تسجيل الاعتراض سيقوم بإيقاف الردود الآلية للذكاء الاصطناعي بشكل فوري وتحويل الملف للمراجعة.
            </p>

            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-500">سبب الاعتراض / ملاحظات</label>
              <textarea 
                required
                rows={4}
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                placeholder="مثال: العميل يدعي سداد المبلغ قبل شهر..."
                className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-rose-500 outline-none resize-none" 
              />
            </div>

            <div className="flex gap-3 pt-4">
              <button 
                type="button" 
                onClick={() => setShowDisputeModal(false)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-colors text-sm"
              >
                إلغاء
              </button>
              <button 
                type="submit" 
                disabled={loading === 'dispute'}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-3 rounded-xl transition-colors text-sm flex justify-center items-center"
              >
                {loading === 'dispute' ? <Loader2 size={16} className="animate-spin" /> : 'تأكيد الاعتراض'}
              </button>
            </div>
          </form>
        </div>
      )}

    </div>
  )
}
