'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Approval } from '@/types'
import { Clock, ShieldCheck, CheckCircle, XCircle, AlertTriangle, FileText } from 'lucide-react'

const PRIORITY_STYLES: Record<string, { label: string, color: string }> = {
  urgent: { label: 'عاجل جداً', color: 'bg-rose-50 text-rose-600 border-rose-200' },
  high:   { label: 'مرتفع', color: 'bg-orange-50 text-orange-600 border-orange-200' },
  medium: { label: 'متوسط', color: 'bg-yellow-50 text-yellow-600 border-yellow-200' },
  low:    { label: 'منخفض', color: 'bg-blue-50 text-blue-600 border-blue-200' },
}

const TYPE_LABELS: Record<string, string> = {
  large_settlement: 'تسوية كبيرة', discount: 'خصم استثنائي', legal_escalation: 'تصعيد قانوني',
  stop_followup: 'إيقاف متابعة', write_off: 'إعفاء من المديونية', ai_learning: 'اعتماد تعلم AI',
  campaign_launch: 'تشغيل حملة', custom: 'مخصص',
}

export default function ApprovalsPage() {
  const [items,   setItems]   = useState<Approval[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('pending')
  
  // Payment Plan Modal State
  const [planModalItem, setPlanModalItem] = useState<Approval | null>(null)
  const [planData, setPlanData] = useState({
    count: 3,
    frequency: 'شهري',
    firstPayment: ''
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/modules/approvals')
      const d = await r.json() as { data?: Approval[] }
      setItems(d.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function act(id: string, status: 'approved' | 'rejected', paymentPlan?: any) {
    await fetch('/api/modules/approvals', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, paymentPlan }),
    })
    setPlanModalItem(null)
    await load()
  }

  function handleActionClick(item: Approval, status: 'approved' | 'rejected') {
    if (status === 'approved' && (item.approval_type === 'custom' || item.approval_type === 'payment_plan')) {
      setPlanModalItem(item)
    } else {
      void act(item.id, status)
    }
  }

  const pending  = items.filter(i => i.status === 'pending')
  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter)

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" >
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">الموافقات والتدخل الإداري</h1>
            <p className="text-slate-500 text-sm">مراجعة العمليات الحساسة واعتمادها قبل التنفيذ الآلي</p>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-2xl p-5 border border-amber-100 flex items-center justify-between shadow-sm animate-in fade-in">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-amber-500 shadow-sm">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="font-bold text-[#1e3e50]">طلبات بانتظار المراجعة ({pending.length})</p>
              <p className="text-xs text-amber-700 mt-0.5">يوجد عمليات معلقة تتطلب اتخاذ قرار إداري للحفاظ على سير العمل.</p>
            </div>
          </div>
          <button onClick={() => setFilter('pending')} className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-xl text-sm font-bold shadow-sm transition-colors">
            استعراض الطلبات
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-white p-2 rounded-2xl shadow-sm border border-slate-100 w-fit">
        {['all','pending','approved','rejected'].map((s: string) => {
          const isActive = filter === s;
          const labels: any = { all: 'الكل', pending: `انتظار (${pending.length})`, approved: 'موافق عليها', rejected: 'مرفوضة' }
          return (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${isActive ? 'bg-[#1e3e50] text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-[#1e3e50]'}`}>
              {labels[s]}
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3e50]"></div></div>
      ) : (
        <div className="grid gap-4">
          {filtered.length === 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 border-dashed p-12 text-center text-slate-400 font-bold">
              <ShieldCheck size={32} className="mx-auto mb-3 text-slate-300" />
              لا توجد طلبات في هذه الفئة
            </div>
          )}
          {filtered.map((item: Approval) => {
            const priorityConf = PRIORITY_STYLES[String(item.priority ?? 'low')] || PRIORITY_STYLES.low;
            
            return (
              <div key={item.id} className="bg-white rounded-2xl p-5 border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-12 h-12 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center shrink-0">
                      <FileText size={24} />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 flex-wrap mb-1.5">
                        <span className="font-bold text-[#1e3e50] text-lg">{item.title}</span>
                        <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${priorityConf.color}`}>
                          {priorityConf.label}
                        </span>
                        <span className="bg-[#f0f4f8] text-slate-600 text-xs px-2.5 py-0.5 rounded-md font-bold">
                          {TYPE_LABELS[String(item.approval_type ?? '')] ?? String(item.approval_type ?? '')}
                        </span>
                      </div>
                      {item.description && <p className="text-slate-500 text-sm mb-2 leading-relaxed">{item.description}</p>}
                      <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
                        <span className="flex items-center gap-1"><Clock size={14} /> {new Date(String(item.created_at ?? '')).toLocaleString('ar-SA')}</span>
                        {item.expires_at && <span className="text-rose-400 flex items-center gap-1">تنتهي: {new Date(String(item.expires_at ?? '')).toLocaleDateString('ar-SA')}</span>}
                      </div>
                    </div>
                  </div>
                  
                  {item.status === 'pending' && (
                    <div className="flex gap-2 w-full lg:w-auto shrink-0 border-t lg:border-t-0 lg:border-r border-slate-100 pt-4 lg:pt-0 lg:pe-5">
                      <button onClick={() => handleActionClick(item, 'approved')}
                        className="flex-1 lg:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-500 hover:text-white border border-emerald-200 font-bold text-sm transition-colors">
                        <CheckCircle size={16} /> موافقة
                      </button>
                      <button onClick={() => handleActionClick(item, 'rejected')}
                        className="flex-1 lg:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white border border-rose-200 font-bold text-sm transition-colors">
                        <XCircle size={16} /> رفض
                      </button>
                    </div>
                  )}
                  
                  {item.status !== 'pending' && (
                    <div className="flex items-center justify-center lg:justify-end w-full lg:w-auto border-t lg:border-t-0 lg:border-r border-slate-100 pt-4 lg:pt-0 lg:pe-5 shrink-0">
                      <span className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border ${item.status === 'approved' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' : 'bg-rose-50 text-rose-600 border-rose-200'}`}>
                        {item.status === 'approved' ? <><CheckCircle size={16} /> تمت الموافقة</> : <><XCircle size={16} /> تم الرفض</>}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Plan Modal */}
      {planModalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-[#1e3e50] mb-1">تحديد خطة التقسيط</h3>
              <p className="text-sm text-slate-500 mb-6">يرجى إدخال تفاصيل الدفع لاعتمادها وإرسالها للعميل.</p>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">عدد الأقساط</label>
                  <select 
                    value={planData.count} 
                    onChange={e => setPlanData({ ...planData, count: Number(e.target.value) })}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#1e3e50]/20"
                  >
                    {[2,3,4,6,12].map(n => <option key={n} value={n}>{n} أقساط</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">فترة السداد</label>
                  <select 
                    value={planData.frequency} 
                    onChange={e => setPlanData({ ...planData, frequency: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#1e3e50]/20"
                  >
                    <option value="شهري">شهري</option>
                    <option value="أسبوعي">أسبوعي</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">الدفعة الأولى المطلوبة للبدء</label>
                  <div className="relative">
                    <input 
                      type="number"
                      placeholder="مثال: 500"
                      value={planData.firstPayment}
                      onChange={e => setPlanData({ ...planData, firstPayment: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 pe-12 focus:outline-none focus:ring-2 focus:ring-[#1e3e50]/20"
                    />
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-400 font-bold text-sm">
                      SAR
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-4 border-t border-slate-100 flex items-center justify-end gap-3">
              <button onClick={() => setPlanModalItem(null)} className="px-5 py-2.5 rounded-xl font-bold text-slate-500 hover:bg-slate-200/50 transition-colors">
                إلغاء
              </button>
              <button 
                disabled={!planData.firstPayment}
                onClick={() => act(planModalItem.id, 'approved', planData)} 
                className="px-6 py-2.5 rounded-xl font-bold bg-[#1e3e50] text-white hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                تأكيد واعتماد
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
