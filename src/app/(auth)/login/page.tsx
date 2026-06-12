'use client'

import { useState } from 'react'
import { loginAction } from '@/lib/actions/auth'
import Link from 'next/link'

export default function LoginPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const formData = new FormData(e.currentTarget)
    const result = await loginAction(formData)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-1/2 bg-white border-r border-slate-200 flex-col justify-center items-center p-12">
        <div className="max-w-sm">
          <div className="w-12 h-12 bg-brand-600 rounded-xl flex items-center justify-center font-display font-bold text-xl mb-8">
            Ω
          </div>
          <h1 className="text-3xl font-display font-bold mb-3">AI Debt OS</h1>
          <p className="text-slate-500 text-lg leading-relaxed">
            Intelligent debt collection platform with AI-powered scoring, WhatsApp integration, and real-time analytics.
          </p>
          <div className="mt-12 grid grid-cols-2 gap-4">
            {[
              { label: 'Collection Rate', value: '94%' },
              { label: 'Response Time', value: '< 2h' },
              { label: 'Active Debts', value: '10K+' },
              { label: 'AI Actions/day', value: '500+' },
            ].map(stat => (
              <div key={stat.label} className="bg-slate-50 rounded-lg p-4">
                <div className="text-2xl font-display font-bold text-brand-400">{stat.value}</div>
                <div className="text-slate-500 text-sm mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-brand-600 rounded-lg flex items-center justify-center font-display font-bold">Ω</div>
            <span className="font-display font-semibold text-lg">AI Debt OS</span>
          </div>

          <h2 className="text-2xl font-display font-bold mb-1">Welcome back</h2>
          <p className="text-slate-500 mb-8">Sign in to your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                name="email"
                type="email"
                required
                autoComplete="email"
                className="input"
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="input"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-slate-400 text-sm mt-6">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="text-brand-400 hover:text-brand-300">
              Register your company
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
