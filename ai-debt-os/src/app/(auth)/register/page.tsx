'use client'

import { useState } from 'react'
import { registerAction } from '@/lib/actions/auth'
import Link from 'next/link'

export default function RegisterPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const formData = new FormData(e.currentTarget)
    const result = await registerAction(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-10 justify-center">
          <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center font-display font-bold">Ω</div>
          <span className="font-display font-semibold text-lg">AI Debt OS</span>
        </div>

        <div className="card p-8">
          <h2 className="text-2xl font-display font-bold mb-1">Create your workspace</h2>
          <p className="text-white/40 mb-8">Set up your company and admin account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Company Name</label>
              <input name="company_name" type="text" required className="input" placeholder="Acme Collection Co." />
            </div>
            <div>
              <label className="label">Your Full Name</label>
              <input name="full_name" type="text" required className="input" placeholder="Jane Smith" />
            </div>
            <div>
              <label className="label">Email</label>
              <input name="email" type="email" required autoComplete="email" className="input" placeholder="you@company.com" />
            </div>
            <div>
              <label className="label">Password</label>
              <input name="password" type="password" required minLength={8} autoComplete="new-password" className="input" placeholder="Minimum 8 characters" />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? 'Creating account...' : 'Create workspace'}
            </button>
          </form>

          <p className="text-center text-white/30 text-sm mt-6">
            Already have an account?{' '}
            <Link href="/login" className="text-brand-400 hover:text-brand-300">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
