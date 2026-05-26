'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDebtStatusAction } from '@/lib/actions/debts'

const STATUSES = [
  'active',
  'in_progress',
  'promised',
  'in_negotiation',
  'payment_plan',
  'partial',
  'settled',
  'legal',
  'disputed',
  'written_off',
]

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  in_progress: 'In Progress',
  promised: 'Promised',
  in_negotiation: 'In Negotiation',
  payment_plan: 'Payment Plan',
  partial: 'Partial Payment',
  settled: 'Settled',
  legal: 'Legal',
  disputed: 'Disputed',
  written_off: 'Written Off',
}

export default function UpdateDebtStatusSelect({
  debtId,
  currentStatus,
}: {
  debtId: string
  currentStatus: string
}) {
  const [status, setStatus] = useState(currentStatus)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStatus = e.target.value
    setStatus(newStatus)
    setSaving(true)
    await updateDebtStatusAction(debtId, newStatus as any)
    setSaving(false)
    router.refresh()
  }

  return (
    <select
      value={status}
      onChange={handleChange}
      disabled={saving}
      className="input text-sm py-1 px-2"
    >
      {STATUSES.map(s => (
        <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
      ))}
    </select>
  )
}
