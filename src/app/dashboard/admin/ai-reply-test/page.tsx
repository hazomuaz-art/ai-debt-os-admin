'use client'

import { useState } from 'react'

export default function Page() {
  const [message, setMessage] = useState('')
  const [response, setResponse] = useState('')
  const [loading, setLoading] = useState(false)

  async function testReply() {
    setLoading(true)
    setResponse('')

    try {
      const res = await fetch('/api/ai/reply-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: 'ar', message }),
      })

      const data = await res.json()
      setResponse(data?.data?.response || JSON.stringify(data, null, 2))
    } catch (err) {
      setResponse(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 900 }}>
      <h1>AI Reply Test</h1>

      <textarea
        style={{ width: '100%', height: 160, padding: 12, color: '#000' }}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="اكتب رسالة العميل هنا..."
      />

      <br />
      <br />

      <button onClick={testReply} disabled={loading || !message}>
        {loading ? 'Testing...' : 'Generate Reply'}
      </button>

      <pre style={{ marginTop: 24, whiteSpace: 'pre-wrap' }}>
        {response}
      </pre>
    </main>
  )
}
