'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SubscriptionActionButtons({
  companyId,
  status,
}: {
  companyId: string
  status: string | null
}) {
  const [loading, setLoading] = useState<'activate' | 'suspend' | null>(null)
  const router = useRouter()

  async function run(action: 'activate' | 'suspend') {
    setLoading(action)
    try {
      await fetch(`/api/platform/companies/${companyId}/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      router.refresh()
    } finally {
      setLoading(null)
    }
  }

  const isActive = status === 'active'

  return (
    <div className="flex gap-2">
      <button
        onClick={() => run('activate')}
        disabled={loading !== null || isActive}
        className="bg-[#0e7a54] hover:bg-slate-800 disabled:opacity-40 text-white font-bold text-sm px-4 py-2 rounded-xl transition-colors"
      >
        {loading === 'activate' ? '...' : 'تفعيل'}
      </button>
      <button
        onClick={() => run('suspend')}
        disabled={loading !== null || status === 'suspended'}
        className="bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-bold text-sm px-4 py-2 rounded-xl transition-colors"
      >
        {loading === 'suspend' ? '...' : 'تعليق'}
      </button>
    </div>
  )
}
