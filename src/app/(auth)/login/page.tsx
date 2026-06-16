'use client'

import { useState, useEffect } from 'react'
import { loginAction } from '@/lib/actions/auth'
import Link from 'next/link'
import { ShieldCheck, Activity, Users } from 'lucide-react'

export default function LoginPage() {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('inactive=true')) {
      setError('حسابك قيد المراجعة بانتظار موافقة الإدارة. يرجى المحاولة لاحقاً.')
      window.history.replaceState({}, '', '/login')
    }
  }, [])

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
    <div dir="rtl" className="min-h-screen flex items-center justify-center bg-[#0b0e14] p-4 sm:p-8 font-sans">

      <div className="flex w-full max-w-5xl bg-[#151a23] rounded-3xl overflow-hidden border border-[#222a36] shadow-2xl">

        {/* Form panel */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 sm:p-16">
          <div className="w-full max-w-sm">
            <div className="flex items-center gap-3 mb-10">
              <div className="w-10 h-10 bg-[#10b981] rounded-xl flex items-center justify-center text-white">
                <ShieldCheck size={22} />
              </div>
              <span className="font-bold text-xl text-white tracking-tight">AI DEBT OS</span>
            </div>

            <h2 className="text-3xl font-bold mb-2 text-white">مرحباً بك مجدداً</h2>
            <p className="text-[#8b95a7] mb-8">سجّل الدخول للوصول إلى لوحة التحكم</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-300 mb-2">البريد الإلكتروني</label>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full bg-[#0d1117] border border-[#222a36] text-slate-100 rounded-xl px-4 py-3 placeholder:text-[#5f6b7e] focus:outline-none focus:border-[#10b981] focus:ring-2 focus:ring-[#10b981]/30 transition-colors"
                  placeholder="admin@example.com"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-300 mb-2">كلمة المرور</label>
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full bg-[#0d1117] border border-[#222a36] text-slate-100 rounded-xl px-4 py-3 placeholder:text-[#5f6b7e] focus:outline-none focus:border-[#10b981] focus:ring-2 focus:ring-[#10b981]/30 transition-colors"
                  placeholder="••••••••"
                  dir="ltr"
                />
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 text-rose-400 text-sm font-medium">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="w-full bg-[#10b981] hover:bg-[#0e8f68] disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors mt-4">
                {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
              </button>
            </form>

            <p className="text-center text-[#5f6b7e] text-sm mt-8">
              ليس لديك حساب؟ اطلب من مدير النظام في شركتك إرسال دعوة لك.
            </p>
          </div>
        </div>

        {/* Info panel */}
        <div className="hidden lg:flex w-1/2 flex-col justify-center items-center p-16 relative overflow-hidden bg-gradient-to-br from-[#0e7a54] via-[#0c5a45] to-[#0d1117]">
          <div className="absolute top-0 end-0 -mt-20 -me-20 w-80 h-80 bg-emerald-400/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 start-0 -mb-20 -ms-20 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl"></div>

          <div className="relative z-10 w-full max-w-md">
            <h1 className="text-4xl font-bold mb-4 text-white leading-tight">AI DEBT OS</h1>
            <p className="text-white/80 text-lg leading-relaxed mb-12">
              نظام التحصيل الذكي: تفاوض آلي عبر الواتساب، قراءة إيصالات الدفع، وتقارير لحظية دقيقة.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/10 rounded-2xl p-5 border border-white/10">
                <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center mb-3">
                  <Activity className="text-emerald-200" size={20} />
                </div>
                <div className="text-3xl font-bold text-white mb-1">٢٤/٧</div>
                <div className="text-white/70 text-sm">تحصيل آلي متواصل</div>
              </div>
              <div className="bg-white/10 rounded-2xl p-5 border border-white/10">
                <div className="w-10 h-10 bg-white/15 rounded-lg flex items-center justify-center mb-3">
                  <Users className="text-emerald-200" size={20} />
                </div>
                <div className="text-3xl font-bold text-white mb-1">AI</div>
                <div className="text-white/70 text-sm">وكيل ذكي يفاوض ويتابع</div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
