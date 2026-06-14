'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare, Loader2, X } from 'lucide-react'

// Unified component — supports both action-based usage and direct debt usage
interface ActionProps {
  actionId: string
  customerId: string
  debtId: string
  phone: string
  message: string
}

interface DirectProps {
  debtId: string
  phone?: string
  customerName?: string
  small?: boolean
}

type Props = ActionProps | DirectProps

function isActionProps(props: Props): props is ActionProps {
  return 'actionId' in props
}

export function SendWhatsAppButton(props: Props) {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle')
  const [showModal, setShowModal] = useState(false)
  const [customMessage, setCustomMessage] = useState('')
  const router = useRouter()

  // Action-based usage (from AI actions list)
  if (isActionProps(props)) {
    async function handleSend() {
      if (!isActionProps(props)) return
      setLoading(true)
      try {
        const res = await fetch('/api/whatsapp/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: props.customerId,
            debt_id: props.debtId,
            phone: props.phone,
            message: props.message,
          }),
        })
        const data = await res.json()
        setStatus(data.error ? 'error' : 'sent')
        if (!data.error) router.refresh()
      } catch {
        setStatus('error')
      } finally {
        setLoading(false)
      }
    }

    if (status === 'sent') return <span className="text-green-400 text-xs">✓ Sent</span>
    if (status === 'error') return <span className="text-red-400 text-xs">✗ Failed</span>

    return (
      <button onClick={handleSend} disabled={loading}
        className="bg-green-600/20 hover:bg-green-600/30 text-green-400 border border-green-500/20 text-xs py-1.5 px-3 rounded-lg transition-all">
        {loading ? '...' : '💬 Send WA'}
      </button>
    )
  }

  // Direct usage (from debt detail page)
  async function handleDirectSend() {
    if (isActionProps(props)) return
    setLoading(true)
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debt_id: props.debtId,
          phone: props.phone,
          message: customMessage,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setStatus('error')
      } else {
        setStatus('sent')
        setShowModal(false)
        router.refresh()
      }
    } catch {
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button 
        onClick={() => setShowModal(true)} 
        className={
          (!isActionProps(props) && props.small)
            ? "flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-100 rounded-lg text-xs font-bold transition-colors"
            : "flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors"
        }
      >
        <MessageSquare size={(!isActionProps(props) && props.small) ? 14 : 18} /> 
        {(!isActionProps(props) && props.small) ? 'إرسال' : 'إرسال واتساب'}
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-[#1e3e50]/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" >
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-[#1e3e50] flex items-center gap-2">
                <MessageSquare className="text-emerald-500" /> إرسال رسالة واتساب
              </h2>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:bg-slate-100 p-1 rounded-md transition-colors"><X className="w-5 h-5" /></button>
            </div>
            {!isActionProps(props) && (
              <p className="text-sm text-slate-500 mb-4 bg-slate-50 p-3 rounded-lg border border-slate-100">
                المرسل إليه: <strong className="text-[#1e3e50]">{props.customerName}</strong> <br/>
                <span className="font-mono text-xs mt-1 inline-block" dir="ltr">{props.phone || 'رقم الهاتف غير مسجل'}</span>
              </p>
            )}
            <textarea
              className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-500 outline-none mb-4 resize-none"
              rows={5}
              placeholder="اكتب رسالتك هنا..."
              value={customMessage}
              onChange={e => setCustomMessage(e.target.value)}
            />
            {status === 'error' && <p className="text-rose-500 text-sm font-bold mb-3">فشل الإرسال. تأكد من إعدادات الواتساب والرقم.</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowModal(false)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3 rounded-xl transition-colors text-sm">إلغاء</button>
              <button onClick={handleDirectSend} disabled={loading || !customMessage.trim()} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors text-sm flex items-center justify-center gap-2 disabled:opacity-50">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                إرسال
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default SendWhatsAppButton
