'use client'

import { useState } from 'react'
import { registerAction } from '@/lib/actions/auth'
import Link from 'next/link'
import { CheckCircle } from 'lucide-react'

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
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#f0f4f8] font-sans text-slate-800" dir="rtl">
      <div className="w-full max-w-5xl bg-white rounded-[2rem] shadow-xl border border-slate-100 flex overflow-hidden min-h-[600px]">
        
        {/* Right Panel - Branding & Info */}
        <div className="hidden lg:flex flex-col justify-between w-1/2 bg-[#1e3e50] p-12 text-white relative overflow-hidden">
          {/* Abstract circles decoration */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 -translate-y-1/2 translate-x-1/2"></div>
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-y-1/2 -translate-x-1/2"></div>

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-16">
              <div className="w-12 h-12 bg-white text-[#1e3e50] rounded-xl flex items-center justify-center font-bold text-2xl shadow-lg">Ω</div>
              <span className="font-bold text-2xl tracking-wide">AI Debt OS</span>
            </div>

            <h1 className="text-4xl font-bold leading-tight mb-6">
              مرحباً بك في مستقبل<br />تحصيل الديون الذكي.
            </h1>
            <p className="text-blue-100 text-lg leading-relaxed max-w-md opacity-90">
              أنشئ مساحة العمل الخاصة بشركتك وابدأ في أتمتة عمليات التفاوض والتحصيل بالاعتماد على أحدث تقنيات الذكاء الاصطناعي.
            </p>
          </div>

          <div className="relative z-10 space-y-4">
            <div className="flex items-center gap-3 text-blue-50">
              <CheckCircle className="text-emerald-400" size={20} />
              <span>مكالمات ورسائل مدعومة بالذكاء الاصطناعي</span>
            </div>
            <div className="flex items-center gap-3 text-blue-50">
              <CheckCircle className="text-emerald-400" size={20} />
              <span>دعم كامل للغة العربية واللهجات المحلية</span>
            </div>
            <div className="flex items-center gap-3 text-blue-50">
              <CheckCircle className="text-emerald-400" size={20} />
              <span>تقارير مالية وتوقعات دفع دقيقة</span>
            </div>
          </div>
        </div>

        {/* Left Panel - Form */}
        <div className="w-full lg:w-1/2 p-8 lg:p-12 flex flex-col justify-center">
          <div className="max-w-md w-full mx-auto">
            
            {/* Mobile Header */}
            <div className="flex lg:hidden items-center gap-3 mb-10 justify-center">
              <div className="w-10 h-10 bg-[#1e3e50] text-white rounded-lg flex items-center justify-center font-bold text-xl">Ω</div>
              <span className="font-bold text-xl text-[#1e3e50]">AI Debt OS</span>
            </div>

            <h2 className="text-3xl font-bold text-[#1e3e50] mb-2">إنشاء حساب جديد</h2>
            <p className="text-slate-500 font-medium mb-10">أدخل بيانات شركتك للبدء فوراً</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-2 pl-2">اسم الشركة</label>
                <input name="company_name" type="text" required 
                  className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20" 
                  placeholder="شركة التحصيل المتقدمة..." />
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-600 mb-2 pl-2">الاسم الكامل (المدير)</label>
                <input name="full_name" type="text" required 
                  className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20" 
                  placeholder="محمد عبد الله" />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-600 mb-2 pl-2">البريد الإلكتروني للعمل</label>
                <input name="email" type="email" required autoComplete="email" 
                  className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-left" 
                  placeholder="admin@company.com" dir="ltr" />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-600 mb-2 pl-2">كلمة المرور</label>
                <input name="password" type="password" required minLength={8} autoComplete="new-password" 
                  className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-left" 
                  placeholder="8 أحرف كحد أدنى" dir="ltr" />
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-100 rounded-xl px-4 py-3 text-rose-600 text-sm font-bold flex items-center gap-2">
                  <AlertTriangle size={16} />
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} 
                className="w-full bg-[#1e3e50] hover:bg-slate-800 text-white font-bold text-sm px-6 py-4 rounded-xl transition-colors shadow-md shadow-slate-200 mt-4 disabled:opacity-50">
                {loading ? 'جاري تجهيز مساحة العمل...' : 'إنشاء مساحة العمل'}
              </button>
            </form>

            <p className="text-center text-slate-500 text-sm mt-8 font-medium">
              لديك حساب بالفعل؟{' '}
              <Link href="/login" className="text-blue-600 hover:text-blue-700 font-bold underline underline-offset-4">تسجيل الدخول</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function AlertTriangle({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
    </svg>
  )
}
