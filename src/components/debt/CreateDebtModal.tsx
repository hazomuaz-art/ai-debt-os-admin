'use client'

import { useState, useRef } from 'react'
import { createDebtAction } from '@/lib/actions/debts'
import { createClient } from '@/lib/supabase/client'

export function CreateDebtModal() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<Array<{ id: string; full_name: string }>>([])
  const [collectors, setCollectors] = useState<Array<{ id: string; full_name: string | null; email: string }>>([])
  const formRef = useRef<HTMLFormElement>(null)

  async function openModal() {
    setOpen(true)
    const supabase = createClient()
    const [{ data: custs }, { data: cols }] = await Promise.all([
      supabase.from('customers').select('id, full_name').order('full_name').limit(100),
      supabase.from('profiles').select('id, full_name, email').eq('role', 'collector').limit(50),
    ])
    setCustomers(custs ?? [])
    setCollectors(cols ?? [])
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const formData = new FormData(e.currentTarget)
    const result = await createDebtAction(formData)
    if (result.error) {
      setError(result.error)
      setLoading(false)
    } else {
      setOpen(false)
      formRef.current?.reset()
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button onClick={openModal} className="btn-primary text-sm">
        + New Debt
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="font-display font-semibold text-lg">Create New Debt</h2>
          <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-900 text-xl">×</button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Customer *</label>
              <select name="customer_id" required className="input">
                <option value="">Select customer...</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Original Amount *</label>
              <input name="original_amount" type="number" step="0.01" min="0.01" required className="input" placeholder="10000.00" />
            </div>
            <div>
              <label className="label">Currency</label>
              <select name="currency" className="input" defaultValue="SAR">
                <option value="SAR">SAR</option>
                <option value="USD">USD</option>
                <option value="AED">AED</option>
              </select>
            </div>
            <div>
              <label className="label">Interest Rate %</label>
              <input name="interest_rate" type="number" step="0.01" min="0" className="input" defaultValue="0" />
            </div>
            <div>
              <label className="label">Due Date</label>
              <input name="due_date" type="date" className="input" />
            </div>
            <div>
              <label className="label">Priority</label>
              <select name="priority" className="input" defaultValue="medium">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="label">Status</label>
              <select name="status" className="input" defaultValue="active">
                <option value="active">Active</option>
                <option value="in_progress">In Progress</option>
                <option value="promised">Promised</option>
              </select>
            </div>
            <div>
              <label className="label">Product Type</label>
              <input name="product_type" type="text" className="input" placeholder="Personal loan, Credit card..." />
            </div>
            <div>
              <label className="label">Account Number</label>
              <input name="account_number" type="text" className="input" placeholder="Account #" />
            </div>
            <div className="col-span-2">
              <label className="label">Assign to Collector</label>
              <select name="assigned_to" className="input">
                <option value="">Unassigned</option>
                {collectors.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name ?? c.email}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="label">Notes</label>
              <textarea name="notes" className="input h-16 resize-none" placeholder="Any additional notes..." />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Debt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
