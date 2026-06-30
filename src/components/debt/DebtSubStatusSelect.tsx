'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDebtSubStatusAction } from '@/lib/actions/debts'

export default function DebtSubStatusSelect({
  debtId,
  currentSubStatus,
  categories,
}: {
  debtId: string
  currentSubStatus: string | null
  categories: string[]
}) {
  const [value, setValue] = useState(currentSubStatus ?? '')
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    setValue(next)
    if (!next) return
    setSaving(true)
    await updateDebtSubStatusAction(debtId, next)
    setSaving(false)
    router.refresh()
  }

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={saving}
      className="input text-sm py-1 px-2"
    >
      <option value="">— غير مصنّف —</option>
      {categories.map(cat => (
        <option key={cat} value={cat}>{cat}</option>
      ))}
    </select>
  )
}
