'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDebtStatusAction, updateDebtCompanyCategoryAction } from '@/lib/actions/debts'

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
  companySubStatus,
  companyCategories,
}: {
  debtId: string
  currentStatus: string
  // The AI agent's own company-specific classification currently set on
  // this debt (e.g. "حذف مسترد وجود رخصة / تجديد") — written automatically
  // by classifyDebtOutcome when it recognizes an outcome mid-conversation.
  companySubStatus?: string | null
  // The FULL list of this company's possible outcome categories (from
  // company-import-profiles.ts's outcomeCategories, matching the company's
  // own "تصنيفات الحالات" reference file) — shown as selectable options in
  // this same dropdown so they're visibly present/verifiable per company,
  // not just displayed after the fact once the agent happens to set one.
  // The agent remains the primary way this gets set day-to-day; a human can
  // also pick one directly here when needed.
  companyCategories?: string[] | null
}) {
  const initialValue = companySubStatus && (companyCategories ?? []).includes(companySubStatus)
    ? companySubStatus
    : currentStatus
  const [value, setValue] = useState(initialValue)
  const [saving, setSaving] = useState(false)
  const router = useRouter()

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    setValue(next)
    setSaving(true)
    if ((companyCategories ?? []).includes(next)) {
      await updateDebtCompanyCategoryAction(debtId, next)
    } else {
      await updateDebtStatusAction(debtId, next as any)
    }
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
      {companyCategories && companyCategories.length > 0 && (
        <optgroup label="تصنيفات الشركة">
          {companyCategories.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </optgroup>
      )}
      <optgroup label="حالات عامة">
        {STATUSES.map(s => (
          <option key={s} value={s}>{STATUS_LABELS[s] ?? s}</option>
        ))}
      </optgroup>
    </select>
  )
}
