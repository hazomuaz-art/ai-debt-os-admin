'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function UserStatusButton({
  userId,
  isActive,
}: {
  userId: string
  isActive: boolean
}) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function toggle() {
    setLoading(true)

    try {
      await fetch(`/api/platform/users/${userId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: !isActive,
        }),
      })

      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      className={
        isActive
          ? 'text-red-400 hover:text-red-300'
          : 'text-green-400 hover:text-green-300'
      }
    >
      {loading
        ? '...'
        : isActive
        ? 'Disable'
        : 'Enable'}
    </button>
  )
}
