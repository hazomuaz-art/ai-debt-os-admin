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
      <button onClick={() => setShowModal(true)} className="btn-secondary flex items-center gap-2">
        <MessageSquare className="w-4 h-4" /> Send WhatsApp
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold font-syne">Send WhatsApp</h2>
              <button onClick={() => setShowModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            {!isActionProps(props) && (
              <p className="text-sm text-slate-400 mb-4">
                To: <span className="text-white">{props.customerName}</span> ({props.phone || 'No phone set'})
              </p>
            )}
            <textarea
              className="input w-full mb-4"
              rows={5}
              placeholder="Type your message..."
              value={customMessage}
              onChange={e => setCustomMessage(e.target.value)}
            />
            {status === 'error' && <p className="text-red-400 text-sm mb-3">Failed to send. Check phone number and WhatsApp config.</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleDirectSend} disabled={loading || !customMessage.trim()} className="btn-primary flex-1 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default SendWhatsAppButton
