'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function GenerateActionsButton() {
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null)
  const router = useRouter()

  async function handleGenerate() {
    setLoading(true)
    setStatus(null)
    try {
      const res = await fetch('/api/ai/recommend', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({}),
      })

      const data = await res.json() as {
        success?: boolean
        count?:   number
        actions?: unknown[]
        message?: string
        error?:   string
      }

      if (!res.ok || data.success === false) {
        const msg = data.error ?? data.message ?? `Server error (${res.status})`
        setStatus({ text: msg, ok: false })
        return
      }

      const count = typeof data.count === 'number'
        ? data.count
        : Array.isArray(data.actions) ? data.actions.length : 0

      const label = count === 0
        ? (data.message ?? 'No actions generated')
        : count === 1
          ? 'Generated 1 action'
          : `Generated ${count} actions`

      setStatus({ text: label, ok: true })
      router.refresh()
    } catch (e) {
      setStatus({ text: 'Network error — please try again', ok: false })
    } finally {
      setLoading(false)
      setTimeout(() => setStatus(null), 5000)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {status && (
        <span className={`text-xs ${status.ok ? 'text-green-400' : 'text-red-400'}`}>
          {status.text}
        </span>
      )}
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="btn-primary text-sm flex items-center gap-2"
      >
        {loading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-slate-200 border-t-white rounded-full animate-spin" />
            Generating…
          </>
        ) : (
          <>◆ Generate AI Plan</>
        )}
      </button>
    </div>
  )
}

export default GenerateActionsButton
