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
  active: 'نشط',
  in_progress: 'قيد التنفيذ',
  promised: 'وعد بالسداد',
  in_negotiation: 'قيد التفاوض',
  payment_plan: 'خطة تقسيط',
  partial: 'سداد جزئي',
  settled: 'مُسدد',
  legal: 'إجراء قانوني',
  disputed: 'متنازع عليه',
  written_off: 'معدوم',
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
