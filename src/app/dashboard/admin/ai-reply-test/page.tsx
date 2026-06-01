'use client'

import { useState } from 'react'

type ChatItem = {
  role: 'customer' | 'ai'
  text: string
}

export default function Page() {
  const [message, setMessage] = useState('')
  const [chat, setChat] = useState<ChatItem[]>([])
  const [loading, setLoading] = useState(false)
  const [raw, setRaw] = useState('')

  async function send() {
    const text = message.trim()
    if (!text || loading) return

    setLoading(true)
    setRaw('')
    setChat(prev => [...prev, { role: 'customer', text }])
    setMessage('')

    try {
      const res = await fetch('/api/ai/reply-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ar', message: text }),
      })

      const data = await res.json()
      const reply = data?.data?.response || JSON.stringify(data, null, 2)

      setChat(prev => [...prev, { role: 'ai', text: reply }])
      setRaw(JSON.stringify(data, null, 2))
    } catch (err) {
      const e = String(err)
      setChat(prev => [...prev, { role: 'ai', text: e }])
      setRaw(e)
    } finally {
      setLoading(false)
    }
  }

  function clearChat() {
    setChat([])
    setMessage('')
    setRaw('')
  }

  return (
    <main className="p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-syne">AI WhatsApp Collector Test</h1>
        <p className="text-slate-400 text-sm mt-1">
          صفحة اختبار مفتوحة تكلم فيها الـ AI كأنك عميل واتساب حقيقي.
        </p>
      </div>

      <div className="card min-h-[520px] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Live Conversation</h2>
            <p className="text-xs text-slate-500 mt-1">
              اكتب أي سيناريو: اعتراض، سداد، غضب، رقم غلط، إنجليزي، أردو، وعد سداد.
            </p>
          </div>

          <button
            onClick={clearChat}
            className="px-3 py-1 rounded-lg text-xs bg-red-500/10 text-red-300 border border-red-500/20"
          >
            Clear
          </button>
        </div>

        <div className="space-y-3 min-h-[320px]">
          {chat.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-24">
              ابدأ بكتابة رسالة العميل تحت.
            </p>
          ) : (
            chat.map((item, index) => (
              <div
                key={index}
                className={`flex ${item.role === 'customer' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap leading-6 ${
                    item.role === 'customer'
                      ? 'bg-surface-300 text-slate-100'
                      : 'bg-brand-600 text-white'
                  }`}
                >
                  <div className="text-[10px] opacity-60 mb-1">
                    {item.role === 'customer' ? 'Customer' : 'AI Collector'}
                  </div>
                  {item.text}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="flex gap-2 pt-4 border-t border-white/10">
          <textarea
            className="flex-1 min-h-[90px] rounded-xl bg-surface-300 border border-white/10 p-3 text-sm outline-none focus:border-brand-500"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="اكتب رسالة العميل هنا..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) void send()
            }}
          />

          <button
            onClick={() => void send()}
            disabled={loading || !message.trim()}
            className="px-5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '...' : 'Send'}
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Ctrl + Enter للإرسال
        </p>
      </div>

      <details className="card">
        <summary className="cursor-pointer text-sm text-slate-300">
          Raw API Result
        </summary>
        <pre className="mt-4 text-xs whitespace-pre-wrap text-slate-400 overflow-auto">
          {raw || 'No response yet'}
        </pre>
      </details>
    </main>
  )
}
