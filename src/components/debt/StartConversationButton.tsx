'use client'

import { useState } from 'react'
import { MessageCirclePlus, Loader2, Send, X } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

export function StartConversationButton({
  customerId,
  phone,
}: {
  customerId: string
  phone: string | null
}) {
  const { t, dir } = useTranslation()
  const s = t.pages.start_chat
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function openAndGenerate() {
    setOpen(true); setDone(false); setError(''); setMessage(''); setLoading(true)
    try {
      const r = await fetch('/api/ai/opening-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: customerId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'failed')
      setMessage(d.message ?? '')
    } catch (e: any) {
      setError(e.message || 'error')
    } finally { setLoading(false) }
  }

  async function send() {
    if (!phone) { setError(s.no_phone); return }
    setSending(true); setError('')
    try {
      const r = await fetch('/api/whatsapp/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message, customer_id: customerId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'failed')
      setDone(true)
      setTimeout(() => setOpen(false), 1200)
    } catch (e: any) {
      setError(e.message || 'error')
    } finally { setSending(false) }
  }

  return (
    <>
      <button
        onClick={openAndGenerate}
        title={s.start}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white border border-emerald-500/20 font-bold rounded-lg text-xs transition-colors"
      >
        <MessageCirclePlus size={15} /> {s.start}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div dir={dir} className="bg-[#151a23] border border-[#222a36] rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[#222a36]">
              <h2 className="font-bold text-lg text-white">{s.title}</h2>
              <button onClick={() => setOpen(false)} className="text-[#8b95a7] hover:text-white text-xl">×</button>
            </div>
            <div className="p-5 space-y-4">
              {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">{error}</div>}
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-[#8b95a7] text-sm">
                  <Loader2 size={18} className="animate-spin" /> {s.generating}
                </div>
              ) : done ? (
                <div className="flex items-center justify-center gap-2 py-10 text-emerald-400 font-bold">
                  <Send size={18} /> {s.sent}
                </div>
              ) : (
                <>
                  <label className="label">{s.message_label}</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={4}
                    className="input resize-none leading-relaxed"
                    dir="rtl"
                  />
                  <div className="flex gap-3 pt-1">
                    <button onClick={() => setOpen(false)} className="btn-secondary flex-1">{s.cancel}</button>
                    <button onClick={send} disabled={sending || !message.trim()} className="btn-primary flex-1">
                      {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      {s.send_whatsapp}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default StartConversationButton
