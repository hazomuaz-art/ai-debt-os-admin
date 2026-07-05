'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { exportCustomerDataAction } from '@/lib/actions/debts'

export function ExportCustomerDataButton({
  customerId,
  customerName,
}: {
  customerId: string
  customerName: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleExport() {
    setLoading(true); setError('')
    const r = await exportCustomerDataAction(customerId)
    if (r?.error || !r.data) {
      setError(r?.error ?? 'فشل التصدير')
      setLoading(false)
      return
    }
    const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${customerName.replace(/\s+/g, '_')}_data_export_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setLoading(false)
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={handleExport}
        disabled={loading}
        className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#222a36] text-[#8b95a7] hover:text-white border border-[#222a36] font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} تصدير بيانات العميل
      </button>
      {error && <span className="text-rose-400 text-xs">{error}</span>}
    </div>
  )
}

export default ExportCustomerDataButton
