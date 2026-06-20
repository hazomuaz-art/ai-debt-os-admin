'use client'

import { useState, useRef } from 'react'
import { createCustomerAction } from '@/lib/actions/debts'
import PortfolioFieldsSection from '@/components/debt/PortfolioFieldsSection'

export function CreateCustomerModal() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const formData = new FormData(e.currentTarget)
    const result = await createCustomerAction(formData)
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
    return <button onClick={() => setOpen(true)} className="btn-primary text-sm">+ New Customer</button>
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#222a36]">
          <h2 className="font-display font-semibold text-lg">Add Customer</h2>
          <button onClick={() => setOpen(false)} className="text-[#8b95a7] hover:text-white text-xl">×</button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Full Name *</label>
              <input name="full_name" type="text" required className="input" placeholder="Mohammed Al-Rashidi" />
            </div>
            <div>
              <label className="label">Phone</label>
              <input name="phone" type="tel" className="input" placeholder="+966 5X XXX XXXX" />
            </div>
            <div>
              <label className="label">WhatsApp</label>
              <input name="whatsapp" type="tel" className="input" placeholder="+966 5X XXX XXXX" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" className="input" placeholder="email@example.com" />
            </div>
            <div>
              <label className="label">National ID</label>
              <input name="national_id" type="text" className="input" placeholder="1XXXXXXXXX" />
            </div>
            <div>
              <label className="label">City</label>
              <input name="city" type="text" className="input" placeholder="Riyadh" />
            </div>
            <div>
              <label className="label">Employer</label>
              <input name="employer" type="text" className="input" placeholder="Company name" />
            </div>
            <div className="col-span-2">
              <label className="label">Monthly Income (SAR)</label>
              <input name="monthly_income" type="number" min="0" className="input" placeholder="5000" />
            </div>
            <div className="col-span-2">
              <label className="label">Notes</label>
              <textarea name="notes" className="input h-16 resize-none" />
            </div>
          </div>

          <PortfolioFieldsSection />

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Saving...' : 'Add Customer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateCustomerModal
