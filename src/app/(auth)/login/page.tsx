'use client'

import { useState } from 'react'
import { loginAction } from '@/lib/actions/auth'
import Link from 'next/link'
import { BrainCircuit, Activity, Users, ArrowLeft } from 'lucide-react'

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
    <div className="min-h-screen flex items-center justify-center bg-[#e6f0f9] p-4 sm:p-8 font-sans" dir="rtl">
      
      <div className="flex w-full max-w-5xl bg-white rounded-3xl overflow-hidden shadow-2xl ring-1 ring-slate-900/5">
        
        {/* Right panel (Form) - in RTL this is on the right */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-8 sm:p-16">
          <div className="w-full max-w-sm">
            <div className="flex items-center gap-3 mb-10">
              <div className="w-10 h-10 bg-[#1e3e50] rounded-xl flex items-center justify-center text-white font-bold">
                <BrainCircuit size={20} />
              </div>
              <span className="font-bold text-xl text-[#1e3e50]">Max Automation</span>
            </div>

            <h2 className="text-3xl font-bold mb-2 text-[#1e3e50]">مرحباً بك مجدداً</h2>
            <p className="text-slate-500 mb-8 font-medium">قم بتسجيل الدخول للوصول إلى لوحة التحكم</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-[#1e3e50] mb-2">البريد الإلكتروني</label>
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full bg-[#f0f4f8] border border-slate-200 text-[#1e3e50] rounded-xl px-4 py-3 focus:outline-none focus:border-[#1e3e50] focus:ring-1 focus:ring-[#1e3e50] transition-colors"
                  placeholder="admin@max.com"
                  dir="ltr"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-[#1e3e50] mb-2">كلمة المرور</label>
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full bg-[#f0f4f8] border border-slate-200 text-[#1e3e50] rounded-xl px-4 py-3 focus:outline-none focus:border-[#1e3e50] focus:ring-1 focus:ring-[#1e3e50] transition-colors"
                  placeholder="••••••••"
                  dir="ltr"
                />
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 text-rose-600 text-sm font-medium">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="w-full bg-[#1e3e50] hover:bg-[#152e3b] text-white font-bold py-3.5 rounded-xl transition-colors mt-4">
                {loading ? 'جاري تسجيل الدخول...' : 'تسجيل الدخول'}
              </button>
            </form>

            <p className="text-center text-slate-500 text-sm mt-8 font-medium">
              ليس لديك حساب؟{' '}
              <Link href="/register" className="text-blue-600 hover:text-blue-800 font-bold">
                تواصل معنا لتسجيل شركتك
              </Link>
            </p>
          </div>
        </div>

        {/* Left panel (Image/Info) - in RTL this is on the left */}
        <div className="hidden lg:flex w-1/2 bg-[#1e3e50] flex-col justify-center items-center p-16 relative overflow-hidden">
          {/* Abstract background shapes */}
          <div className="absolute top-0 right-0 -mt-20 -mr-20 w-80 h-80 bg-white/5 rounded-full blur-3xl"></div>
          <div className="absolute bottom-0 left-0 -mb-20 -ml-20 w-80 h-80 bg-blue-400/10 rounded-full blur-3xl"></div>

          <div className="relative z-10 w-full max-w-md">
            <h1 className="text-4xl font-bold mb-4 text-white leading-tight">AI Debt OS</h1>
            <p className="text-blue-100 text-lg leading-relaxed mb-12 opacity-90">
              النظام الذكي الأول لإدارة وتحصيل الديون. تفاوض آلي عبر الواتساب، تحليل مشاعر، وتقارير لحظية دقيقة.
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border border-white/10">
                <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center mb-3">
                  <Activity className="text-blue-300" size={20} />
                </div>
                <div className="text-3xl font-bold text-white mb-1">94%</div>
                <div className="text-blue-200 text-sm">نسبة التحصيل الناجح</div>
              </div>
              <div className="bg-white/10 backdrop-blur-md rounded-2xl p-5 border border-white/10">
                <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center mb-3">
                  <Users className="text-emerald-300" size={20} />
                </div>
                <div className="text-3xl font-bold text-white mb-1">10K+</div>
                <div className="text-blue-200 text-sm">عميل نشط يومياً</div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
