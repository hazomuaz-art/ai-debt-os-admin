'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { UserPlus, X, AlertCircle, CheckCircle2 } from 'lucide-react'

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
      setError(data.error || 'فشل في إنشاء حساب المستخدم')
    } else {
      setSuccess(`تم إنشاء الحساب بنجاح وإرسال الدعوة إلى ${email}`)
      router.refresh()
      setTimeout(() => {
        setOpen(false)
        setSuccess('')
      }, 2000)
    }

    setLoading(false)
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-[#1e3e50] hover:bg-slate-800 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2">
        <UserPlus size={18} /> دعوة عضو جديد
      </button>
    )
  }

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-[#1e3e50]/40 backdrop-blur-sm animate-in fade-in" dir="rtl">
      <div className="bg-white border border-slate-100 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom-4">
        
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-[#fbfdfd] rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
              <UserPlus size={20} />
            </div>
            <h2 className="font-bold text-[#1e3e50] text-lg">إضافة موظف جديد</h2>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          
          {error && (
            <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm font-bold flex items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          
          {success && (
            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl text-emerald-600 text-sm font-bold flex items-start gap-2">
              <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
              <span>{success}</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2 pl-2">الاسم الكامل</label>
            <input name="full_name" type="text" required placeholder="مثال: أحمد محمد"
              className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#1e3e50]" />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2 pl-2">البريد الإلكتروني للعمل</label>
            <input name="email" type="email" required placeholder="employee@company.com" dir="ltr"
              className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#1e3e50] text-left" />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2 pl-2">كلمة مرور مؤقتة</label>
            <input name="password" type="password" required minLength={8} placeholder="8 أحرف كحد أدنى" dir="ltr"
              className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#1e3e50] text-left" />
            <p className="text-xs text-slate-400 font-medium mt-2">سيُطلب من الموظف تغيير كلمة المرور عند أول تسجيل دخول.</p>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-600 mb-2 pl-2">الدور (الصلاحية)</label>
            <select name="role" className="w-full bg-[#f0f4f8] border-none text-[#1e3e50] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#1e3e50]">
              <option value="collector">موظف تحصيل (Collector)</option>
              <option value="manager">مشرف تحصيل (Manager)</option>
              <option value="admin">مدير نظام (Admin)</option>
            </select>
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={() => setOpen(false)} 
              className="flex-1 bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 font-bold text-sm px-6 py-3 rounded-xl transition-colors">
              إلغاء
            </button>
            <button type="submit" disabled={loading} 
              className="flex-1 bg-[#1e3e50] hover:bg-slate-800 text-white font-bold text-sm px-6 py-3 rounded-xl transition-colors disabled:opacity-50">
              {loading ? 'جاري الإنشاء...' : 'إنشاء حساب الموظف'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
