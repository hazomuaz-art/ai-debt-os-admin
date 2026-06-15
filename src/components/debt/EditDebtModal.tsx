'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Edit2, X, Loader2 } from 'lucide-react'

export default function EditDebtModal({ debt, customer }: { debt: any, customer: any }) {
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const [formData, setFormData] = useState({
    full_name: customer?.full_name || '',
    phone: customer?.phone || '',
    whatsapp: customer?.whatsapp || '',
    national_id: customer?.national_id || '',
    current_balance: debt?.current_balance || '',
    due_date: debt?.due_date || '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    try {
      await supabase.from('customers').update({
        full_name: formData.full_name,
        phone: formData.phone,
        whatsapp: formData.whatsapp,
        national_id: formData.national_id,
      }).eq('id', customer.id)

      await supabase.from('debts').update({
        current_balance: formData.current_balance,
        due_date: formData.due_date || null,
      }).eq('id', debt.id)

      setIsOpen(false)
      router.refresh()
    } catch (error) {
      console.error(error)
      alert('حدث خطأ أثناء التحديث')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-4 py-2 bg-[#151a23] text-slate-300 border border-[#222a36] rounded-lg hover:bg-[#1a212c] font-bold text-sm transition-colors"
      >
        <Edit2 size={16} />
        تعديل البيانات
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" >
          <div className="bg-[#151a23] rounded-2xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[#222a36] flex items-center justify-between bg-[#222a36]">
              <h2 className="text-lg font-bold text-white">تعديل بيانات العميل والمديونية</h2>
              <button onClick={() => setIsOpen(false)} className="text-[#5f6b7e] hover:text-slate-300">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-4">
                <h3 className="font-bold text-slate-200 border-b pb-2">بيانات العميل</h3>
                <div>
                  <label className="block text-sm font-bold text-slate-200 mb-1">اسم العميل</label>
                  <input required type="text" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1">رقم الجوال</label>
                    <input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-end" dir="ltr" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1">رقم الواتساب</label>
                    <input type="text" value={formData.whatsapp} onChange={e => setFormData({...formData, whatsapp: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-end" dir="ltr" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-200 mb-1">رقم الهوية</label>
                  <input type="text" value={formData.national_id} onChange={e => setFormData({...formData, national_id: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-end" dir="ltr" />
                </div>
              </div>

              <div className="space-y-4 pt-4">
                <h3 className="font-bold text-slate-200 border-b pb-2">بيانات المديونية</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1">مبلغ المديونية الحالي</label>
                    <input required type="number" step="0.01" value={formData.current_balance} onChange={e => setFormData({...formData, current_balance: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-end" dir="ltr" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-200 mb-1">تاريخ الاستحقاق</label>
                    <input type="date" value={formData.due_date?.split('T')[0] || ''} onChange={e => setFormData({...formData, due_date: e.target.value})} className="w-full px-3 py-2 border rounded-lg" />
                  </div>
                </div>
              </div>

              <div className="pt-6 flex gap-3">
                <button type="button" onClick={() => setIsOpen(false)} className="flex-1 px-4 py-2 border border-[#222a36] text-slate-300 rounded-xl font-bold hover:bg-[#1a212c]">
                  إلغاء
                </button>
                <button type="submit" disabled={loading} className="flex-1 bg-[#0e7a54] text-white px-4 py-2 rounded-xl font-bold hover:bg-[#2a5268] flex items-center justify-center gap-2">
                  {loading ? <Loader2 size={18} className="animate-spin" /> : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
