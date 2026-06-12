'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'

export function InviteUserModal({ companyId }: { companyId: string }) {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const router = useRouter()

  useEffect(() => {
    setMounted(true)
  }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const full_name = formData.get('full_name') as string
    const role = formData.get('role') as string
    const password = formData.get('password') as string

    const res = await fetch('/api/auth/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, full_name, role, password, company_id: companyId }),
    })

    const data = await res.json()

    if (!res.ok || data.error) {
      setError(data.error || 'Failed to create user')
    } else {
      setSuccess(`${role} account created for ${email}`)
      router.refresh()
      setTimeout(() => {
        setOpen(false)
        setSuccess('')
      }, 1500)
    }

    setLoading(false)
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary text-sm">
        + Invite Member
      </button>
    )
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <h2 className="font-display font-semibold text-slate-900">Invite Team Member</h2>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-900 text-xl">
            x
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">{error}</div>}
          {success && <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">{success}</div>}

          <div>
            <label className="label">Full Name</label>
            <input name="full_name" type="text" required className="input" />
          </div>

          <div>
            <label className="label">Email</label>
            <input name="email" type="email" required className="input" />
          </div>

          <div>
            <label className="label">Temporary Password</label>
            <input name="password" type="password" required minLength={8} className="input" />
          </div>

          <div>
            <label className="label">Role</label>
            <select name="role" className="input">
              <option value="collector">Collector</option>
              <option value="manager">Manager</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? 'Creating...' : 'Create Account'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
