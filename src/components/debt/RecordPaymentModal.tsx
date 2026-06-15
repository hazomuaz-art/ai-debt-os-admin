'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { recordPaymentAction } from '@/lib/actions/debts'
import { formatCurrency } from '@/lib/utils'
import { X, PlusCircle } from 'lucide-react'

export default function RecordPaymentModal({
  debtId,
  currentBalance,
  currency,
}: {
  debtId: string
  currentBalance: number
  currency: string
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const form = new FormData(e.currentTarget)
    const result = await recordPaymentAction({
      debt_id: debtId,
      amount: Number(form.get('amount')),
      payment_date: form.get('payment_date') as string,
      payment_method: form.get('payment_method') as string,
      reference_number: form.get('reference_number') as string,
      notes: form.get('notes') as string,
    })
    if (result.error) {
      setError(result.error)
    } else {
      setOpen(false)
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary flex items-center gap-2 text-sm">
        <PlusCircle className="w-4 h-4" /> Record Payment
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="card w-full max-w-md">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold font-syne">Record Payment</h2>
              <button onClick={() => setOpen(false)}><X className="w-5 h-5 text-[#5f6b7e]" /></button>
            </div>
            <p className="text-sm text-[#5f6b7e] mb-4">
              Outstanding balance: <span className="text-slate-900 font-medium">{formatCurrency(currentBalance, currency)}</span>
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Amount *</label>
                <input name="amount" type="number" step="0.01" min="0.01" max={currentBalance} required className="input w-full" placeholder="0.00" />
              </div>
              <div>
                <label className="label">Payment Date *</label>
                <input name="payment_date" type="date" required className="input w-full"
                  defaultValue={new Date().toISOString().split('T')[0]} />
              </div>
              <div>
                <label className="label">Payment Method</label>
                <select name="payment_method" className="input w-full">
                  <option value="">Select method</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="online">Online Payment</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="label">Reference Number</label>
                <input name="reference_number" type="text" className="input w-full" placeholder="Transaction ref..." />
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea name="notes" className="input w-full" rows={2} placeholder="Any additional notes..." />
              </div>

              {error && <p className="text-red-400 text-sm">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">Cancel</button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">
                  {loading ? 'Saving...' : 'Record Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
