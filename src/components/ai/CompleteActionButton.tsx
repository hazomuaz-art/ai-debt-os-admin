'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export function CompleteActionButton({ actionId }: { actionId: string }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleComplete() {
    setLoading(true)
    const supabase = createClient()
    // Real gap found during a full-system audit: { error } was never
    // checked — a rejected update still refreshed the page as if the action
    // had been marked completed, when it silently hadn't.
    const { error } = await supabase
      .from('ai_actions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', actionId)
    if (error) {
      console.error(error)
      alert('حدث خطأ أثناء إكمال الإجراء')
    } else {
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <button
      onClick={handleComplete}
      disabled={loading}
      className="btn-secondary text-xs py-1.5 px-3 whitespace-nowrap"
    >
      {loading ? '...' : '✓ Done'}
    </button>
  )
}
