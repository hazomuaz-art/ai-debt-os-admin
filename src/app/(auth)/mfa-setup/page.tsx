'use client'

import { useState, useEffect, useCallback } from 'react'
import { enrollMfaAction, cancelMfaEnrollmentAction, verifyMfaEnrollmentAction, logoutAction } from '@/lib/actions/auth'
import { ShieldCheck } from 'lucide-react'

export default function MfaSetupPage({ searchParams }: { searchParams: { required?: string } }) {
  const required = searchParams?.required === 'true'
  const [factorId, setFactorId] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)

  const startEnrollment = useCallback(async () => {
    setInitializing(true)
    setError('')
    const result = await enrollMfaAction()
    if ('error' in result) {
      setError(result.error)
    } else {
      setFactorId(result.factorId)
      setQrCode(result.qrCode)
      setSecret(result.secret)
    }
    setInitializing(false)
  }, [])

  useEffect(() => { void startEnrollment() }, [startEnrollment])

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const result = await verifyMfaEnrollmentAction(factorId, code)
    if (result?.error) {
      setError(result.error)
      setLoading(false)
    }
  }

  async function handleRetry() {
    if (factorId) await cancelMfaEnrollmentAction(factorId)
    setCode('')
    await startEnrollment()
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-[#0b0e14] p-4 sm:p-8 font-sans">
      <div className="w-full max-w-md bg-[#151a23] rounded-3xl overflow-hidden border border-[#222a36] shadow-2xl p-8 sm:p-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-[#10b981] rounded-xl flex items-center justify-center text-white">
            <ShieldCheck size={22} />
          </div>
          <span className="font-bold text-xl text-white tracking-tight">تفعيل المصادقة الثنائية</span>
        </div>

        {required && (
          <p className="text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-3 text-sm font-bold mb-6">
            تفعيل المصادقة الثنائية إلزامي لحسابك (صلاحية إدارية) قبل الدخول للنظام.
          </p>
        )}

        {initializing ? (
          <div className="flex justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#10b981]" />
          </div>
        ) : (
          <>
            <ol className="text-[#8b95a7] text-sm space-y-2 mb-6 list-decimal list-inside">
              <li>افتح تطبيق مصادقة على جوالك (Google Authenticator أو Authy)</li>
              <li>امسح الرمز أدناه، أو أدخل الرمز السري يدوياً</li>
              <li>أدخل الرمز المكوّن من 6 أرقام الظاهر بالتطبيق للتأكيد</li>
            </ol>

            {qrCode && (
              <div className="flex justify-center mb-4 bg-white rounded-2xl p-4">
                <div dangerouslySetInnerHTML={{ __html: qrCode }} />
              </div>
            )}

            {secret && (
              <div className="bg-[#0d1117] border border-[#222a36] rounded-xl px-4 py-3 mb-6 text-center">
                <p className="text-[#5f6b7e] text-xs mb-1">أو أدخل الرمز السري يدوياً</p>
                <p className="font-mono font-bold text-white tracking-widest" dir="ltr">{secret}</p>
              </div>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              <input
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                dir="ltr"
                required
                className="w-full bg-[#0d1117] border border-[#222a36] text-slate-100 rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] placeholder:text-[#5f6b7e] focus:outline-none focus:border-[#10b981] focus:ring-2 focus:ring-[#10b981]/30 transition-colors"
              />

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-rose-400 text-sm font-medium">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading || code.length !== 6} className="w-full bg-[#10b981] hover:bg-[#0e8f68] disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors">
                {loading ? 'جارٍ التفعيل...' : 'تفعيل والمتابعة'}
              </button>
              <button type="button" onClick={handleRetry} className="w-full text-[#8b95a7] hover:text-white text-sm font-bold py-2">
                لم يعمل الرمز؟ توليد رمز جديد
              </button>
            </form>
          </>
        )}

        <form action={logoutAction} className="mt-6 pt-6 border-t border-[#222a36]">
          <button type="submit" className="w-full text-[#5f6b7e] hover:text-rose-400 text-sm font-bold">تسجيل الخروج</button>
        </form>
      </div>
    </div>
  )
}
