'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Building2, X, AlertCircle, CheckCircle2, Copy } from 'lucide-react'
import { createCompanyAction } from '@/lib/actions/platform'

export function CreateCompanyModal() {
  const [mounted, setMounted] = useState(false)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ email: string; password: string } | null>(null)
  const router = useRouter()

  useEffect(() => { setMounted(true) }, [])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const formData = new FormData(e.currentTarget)
    const admin_email = String(formData.get('admin_email') ?? '')

    const res = await createCompanyAction({
      company_name: String(formData.get('company_name') ?? ''),
      admin_email,
      admin_full_name: String(formData.get('admin_full_name') ?? ''),
      plan_name: String(formData.get('plan_name') ?? 'starter') as any,
    })

    if ('error' in res) {
      setError(res.error)
    } else {
      setResult({ email: admin_email, password: res.temp_password })
      router.refresh()
    }
    setLoading(false)
  }

  function closeAndReset() {
    setOpen(false)
    setResult(null)
    setError('')
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2">
        <Building2 size={18} /> شركة جديدة
      </button>
    )
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[#0e7a54]/40 backdrop-blur-sm">
      <div className="bg-[#151a23] border border-[#222a36] rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">

        <div className="flex items-center justify-between p-6 border-b border-[#222a36] bg-[#0d1117] rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
              <Building2 size={20} />
            </div>
            <h2 className="font-bold text-white text-lg">إنشاء شركة جديدة</h2>
          </div>
          <button type="button" onClick={closeAndReset} className="text-[#5f6b7e] hover:text-slate-300 hover:bg-[#222a36] p-2 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {result ? (
          <div className="p-6 space-y-5">
            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-600 text-sm font-bold flex items-start gap-2">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <span>تم إنشاء الشركة بنجاح. أرسل هذه البيانات للعميل — لن تظهر كلمة المرور مرة أخرى.</span>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-[#8b95a7] mb-1">البريد الإلكتروني</label>
                <div dir="ltr" className="bg-[#0d1117] text-white rounded-xl px-4 py-3 text-sm font-mono">{result.email}</div>
              </div>
              <div>
                <label className="block text-xs font-bold text-[#8b95a7] mb-1">كلمة المرور المؤقتة</label>
                <div className="flex items-center gap-2">
                  <div dir="ltr" className="flex-1 bg-[#0d1117] text-white rounded-xl px-4 py-3 text-sm font-mono">{result.password}</div>
                  <button type="button" onClick={() => navigator.clipboard.writeText(result.password)}
                    className="bg-[#222a36] hover:bg-[#2a3340] text-slate-300 p-3 rounded-xl transition-colors">
                    <Copy size={16} />
                  </button>
                </div>
              </div>
            </div>
            <button type="button" onClick={closeAndReset}
              className="w-full bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors">
              تم
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm font-bold flex items-start gap-2">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2 ps-2">اسم الشركة</label>
              <input name="company_name" type="text" required placeholder="مثال: شركة التحصيل المتقدم"
                className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0e7a54]" />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2 ps-2">اسم أول مستخدم (أدمن الشركة)</label>
              <input name="admin_full_name" type="text" required placeholder="مثال: أحمد محمد"
                className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0e7a54]" />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2 ps-2">البريد الإلكتروني</label>
              <input name="admin_email" type="email" required placeholder="admin@client.com" dir="ltr"
                className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0e7a54] text-end" />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-300 mb-2 ps-2">الخطة المبدئية</label>
              <select name="plan_name" className="w-full bg-[#0d1117] border-none text-white rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#0e7a54]">
                <option value="starter">Starter</option>
                <option value="business">Business</option>
                <option value="growth">Growth</option>
                <option value="enterprise">Enterprise</option>
              </select>
              <p className="text-xs text-[#5f6b7e] font-medium mt-2">يبدأ الحساب بحالة "تجريبي" (14 يوم) — فعّله من صفحة الشركة بعد استلام الدفعة.</p>
            </div>

            <div className="flex gap-3 pt-4 border-t border-[#222a36]">
              <button type="button" onClick={closeAndReset}
                className="flex-1 bg-[#151a23] hover:bg-[#1a212c] text-slate-300 border border-[#222a36] font-bold text-sm px-6 py-3 rounded-xl transition-colors">
                إلغاء
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 bg-[#0e7a54] hover:bg-slate-800 text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors disabled:opacity-50">
                {loading ? 'جاري الإنشاء...' : 'إنشاء الشركة'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  )
}
