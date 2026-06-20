'use client'

import { useState, useRef } from 'react'
import { createCaseAction } from '@/lib/actions/debts'
import { UserPlus, Loader2 } from 'lucide-react'
import PortfolioFieldsSection from '@/components/debt/PortfolioFieldsSection'

export function AddCaseModal() {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true); setError('')
    const result = await createCaseAction(new FormData(e.currentTarget))
    if (result.error) {
      setError(result.error); setLoading(false)
    } else {
      setOpen(false); formRef.current?.reset(); setLoading(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary text-sm">
        <UserPlus size={16} /> إضافة عميل ودين
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div dir="rtl" className="bg-[#151a23] border border-[#222a36] rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-[#222a36] sticky top-0 bg-[#151a23]">
          <h2 className="font-bold text-lg text-white">إضافة عميل ودين جديد</h2>
          <button onClick={() => setOpen(false)} className="text-[#8b95a7] hover:text-white text-xl">×</button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="p-5 space-y-5">
          {error && <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-sm">{error}</div>}

          {/* Customer section */}
          <div>
            <div className="text-xs font-bold text-emerald-400 mb-3">بيانات العميل</div>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">الاسم الكامل *</label>
                <input name="full_name" required className="input" placeholder="محمد عبدالله الراشدي" />
              </div>
              <div>
                <label className="label">الجوال</label>
                <input name="phone" type="tel" className="input" placeholder="+9665XXXXXXXX" dir="ltr" />
              </div>
              <div>
                <label className="label">واتساب</label>
                <input name="whatsapp" type="tel" className="input" placeholder="+9665XXXXXXXX" dir="ltr" />
              </div>
              <div>
                <label className="label">الهوية الوطنية</label>
                <input name="national_id" className="input" placeholder="1XXXXXXXXX" dir="ltr" />
              </div>
              <div>
                <label className="label">المدينة</label>
                <input name="city" className="input" placeholder="الرياض" />
              </div>
            </div>
          </div>

          {/* Debt section */}
          <div className="border-t border-[#222a36] pt-4">
            <div className="text-xs font-bold text-emerald-400 mb-3">بيانات الدين</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">المبلغ الأصلي *</label>
                <input name="original_amount" type="number" step="0.01" min="0.01" required className="input" placeholder="10000.00" dir="ltr" />
              </div>
              <div>
                <label className="label">العملة</label>
                <select name="currency" className="input" defaultValue="SAR">
                  <option value="SAR">SAR</option>
                  <option value="USD">USD</option>
                  <option value="AED">AED</option>
                </select>
              </div>
              <div>
                <label className="label">الجهة الدائنة</label>
                <input name="creditor_name" className="input" placeholder="اسم الشركة / البنك" />
              </div>
              <div>
                <label className="label">نوع المنتج</label>
                <input name="product_type" className="input" placeholder="قرض شخصي، بطاقة ائتمان..." />
              </div>
              <div>
                <label className="label">تاريخ الاستحقاق</label>
                <input name="due_date" type="date" className="input" dir="ltr" />
              </div>
              <div>
                <label className="label">الحالة</label>
                <select name="status" className="input" defaultValue="active">
                  <option value="active">نشط</option>
                  <option value="in_progress">قيد التنفيذ</option>
                  <option value="payment_plan">خطة تقسيط</option>
                  <option value="disputed">متنازع عليه</option>
                </select>
              </div>
              <div>
                <label className="label">الأولوية</label>
                <select name="priority" className="input" defaultValue="medium">
                  <option value="low">منخفضة</option>
                  <option value="medium">متوسطة</option>
                  <option value="high">عالية</option>
                  <option value="urgent">عاجلة</option>
                </select>
              </div>
              <div>
                <label className="label">رقم الحساب</label>
                <input name="account_number" className="input" placeholder="# الحساب" dir="ltr" />
              </div>
              <div className="col-span-2">
                <label className="label">ملاحظات</label>
                <textarea name="notes" className="input h-16 resize-none" placeholder="أي ملاحظات إضافية" />
              </div>
            </div>
          </div>

          <PortfolioFieldsSection />

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary flex-1">إلغاء</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'جاري الحفظ...' : 'إضافة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default AddCaseModal
