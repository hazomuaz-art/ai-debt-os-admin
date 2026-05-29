'use client'

import { Download } from 'lucide-react'

export default function ExportDebtsButton({
  status,
  priority,
}: {
  status?: string
  priority?: string
}) {
  function handleExport() {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (priority) params.set('priority', priority)
    window.location.href = `/api/debts/export?${params.toString()}`
  }

  return (
    <button onClick={handleExport} className="btn-secondary flex items-center gap-2 text-sm">
      <Download className="w-4 h-4" /> Export CSV
    </button>
  )
}
