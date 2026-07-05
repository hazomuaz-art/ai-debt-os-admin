'use client'

import { useState } from 'react'
import { verifyMfaChallengeAction, logoutAction } from '@/lib/actions/auth'
import { ShieldCheck } from 'lucide-react'

export default function MfaChallengePage() {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await verifyMfaChallengeAction(code)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
      setCode('')
    }
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-[#0b0e14] p-4 sm:p-8 font-sans">
      <div className="w-full max-w-md bg-[#151a23] rounded-3xl overflow-hidden border border-[#222a36] shadow-2xl p-8 sm:p-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#10b981] rounded-xl flex items-center justify-center text-white">
            <ShieldCheck size={22} />
          </div>
          <span className="font-bold text-xl text-white tracking-tight">التحقق بخطوتين</span>
        </div>

        <p className="text-[#8b95a7] text-sm mb-6">أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة على جوالك</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            dir="ltr"
            autoFocus
            required
            className="w-full bg-[#0d1117] border border-[#222a36] text-slate-100 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] placeholder:text-[#5f6b7e] focus:outline-none focus:border-[#10b981] focus:ring-2 focus:ring-[#10b981]/30 transition-colors"
          />

          {error && (
            <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-rose-400 text-sm font-medium">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading || code.length !== 6} className="w-full bg-[#10b981] hover:bg-[#0e8f68] disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors">
            {loading ? 'جارٍ التحقق...' : 'تأكيد'}
          </button>
        </form>

        <form action={logoutAction} className="mt-6 pt-6 border-t border-[#222a36]">
          <button type="submit" className="w-full text-[#5f6b7e] hover:text-rose-400 text-sm font-bold">تسجيل الخروج</button>
        </form>
      </div>
    </div>
  )
}
