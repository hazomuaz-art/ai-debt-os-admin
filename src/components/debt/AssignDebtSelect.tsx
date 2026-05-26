'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { assignDebtAction } from '@/lib/actions/debts'

interface Collector {
  id: string
  full_name: string
  email: string
}

export default function AssignDebtSelect({
  debtId,
  currentAssigneeId,
  collectors,
}: {
  debtId: string
  currentAssigneeId?: string | null
  collectors: Collector[]
}) {
  const [saving, setSaving] = useState(false)
  const [value, setValue] = useState(currentAssigneeId ?? '')
  const router = useRouter()

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const collectorId = e.target.value
    setValue(collectorId)
    if (!collectorId) return
    setSaving(true)
    await assignDebtAction(debtId, collectorId)
    setSaving(false)
    router.refresh()
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={saving}
      className="input text-sm py-1 px-2 w-full"
    >
      <option value="">Unassigned</option>
      {collectors.map(c => (
        <option key={c.id} value={c.id}>
          {c.full_name}
        </option>
      ))}
    </select>
  )
}
