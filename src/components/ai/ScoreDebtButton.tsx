'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Brain, Loader2 } from 'lucide-react'

export default function ScoreDebtButton({ debtId }: { debtId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleScore() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/ai/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debt_id: debtId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Score failed')
      router.refresh()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <button onClick={handleScore} disabled={loading} className="btn-secondary flex items-center gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
        Score Debt
      </button>
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  )
}
