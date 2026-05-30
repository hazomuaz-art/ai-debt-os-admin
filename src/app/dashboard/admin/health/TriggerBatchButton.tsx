'use client'

import { useState } from 'react'

export default function TriggerBatchButton() {
  const [loading, setLoading] = useState(false)

  async function runBatch() {
    setLoading(true)
    try {
      await fetch('/api/orchestrator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'manual', batch: true }),
      })
      location.reload()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={runBatch} disabled={loading} className="btn-primary text-xs px-3 py-2">
      {loading ? 'Running...' : 'Trigger Batch'}
    </button>
  )
}
