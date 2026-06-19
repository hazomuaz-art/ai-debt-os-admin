'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Approval } from '@/types'
import { Clock, ShieldCheck, CheckCircle, XCircle, AlertTriangle, FileText } from 'lucide-react'
import { useTranslation } from '@/lib/i18n'

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  high:   'bg-orange-500/10 text-orange-400 border-orange-500/20',
  medium: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  low:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

export default function ApprovalsPage() {
  const { t, dir } = useTranslation()
  const ap = t.pages.approvals
  const PRIORITY_LABELS: Record<string, string> = { urgent: ap.p_urgent, high: ap.p_high, medium: ap.p_medium, low: ap.p_low }
  const TYPE_LABELS: Record<string, string> = {
    large_settlement: ap.t_large_settlement, discount: ap.t_discount, legal_escalation: ap.t_legal_escalation,
    stop_followup: ap.t_stop_followup, write_off: ap.t_write_off, ai_learning: ap.t_ai_learning,
    campaign_launch: ap.t_campaign_launch, custom: ap.t_custom,
    dispute: 'اعتراض على المديونية',
  }

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
    <div dir={dir} className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-xl flex items-center justify-center shrink-0">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">{ap.title}</h1>
            <p className="text-[#8b95a7] text-sm">{ap.subtitle}</p>
          </div>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="bg-amber-500/10 rounded-2xl p-5 border border-amber-500/20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-[#151a23] rounded-full flex items-center justify-center text-amber-400">
              <AlertTriangle size={20} />
            </div>
            <div>
              <p className="font-bold text-white">{ap.banner_title.replace('{n}', String(pending.length))}</p>
              <p className="text-xs text-amber-300/80 mt-0.5">{ap.banner_sub}</p>
            </div>
          </div>
          <button onClick={() => setFilter('pending')} className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-2 rounded-xl text-sm font-bold transition-colors">
            {ap.review_requests}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 bg-[#151a23] p-2 rounded-2xl shadow-sm border border-[#222a36] w-fit">
        {['all','pending','approved','rejected'].map((s: string) => {
          const isActive = filter === s;
          const labels: any = { all: ap.tab_all, pending: ap.tab_pending.replace('{n}', String(pending.length)), approved: ap.tab_approved, rejected: ap.tab_rejected }
          return (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${isActive ? 'bg-[#10b981] text-white shadow-md' : 'text-[#8b95a7] hover:bg-[#1a212c] hover:text-white'}`}>
              {labels[s]}
            </button>
          )
        })}
      </div>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#10b981]"></div></div>
      ) : (
        <div className="grid gap-4">
          {filtered.length === 0 && (
            <div className="bg-[#151a23] rounded-2xl border border-[#222a36] border-dashed p-12 text-center text-[#5f6b7e] font-bold">
              <ShieldCheck size={32} className="mx-auto mb-3 text-[#5f6b7e]" />
              {ap.none_in_category}
            </div>
          )}
          {filtered.map((item: Approval) => {
            const prKey = String(item.priority ?? 'low')
            const prColor = PRIORITY_COLORS[prKey] || PRIORITY_COLORS.low
            const prLabel = PRIORITY_LABELS[prKey] || ap.p_low
            
            return (
              <div key={item.id} className="bg-[#151a23] rounded-2xl p-5 border border-[#222a36] shadow-sm hover:shadow-md transition-shadow">
                <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="w-12 h-12 bg-[#222a36] text-[#5f6b7e] rounded-xl flex items-center justify-center shrink-0">
                      <FileText size={24} />
                    </div>
                    <div>
                      <div className="flex items-center gap-3 flex-wrap mb-1.5">
                        <span className="font-bold text-white text-lg">{item.title}</span>
                        <span className={`px-2.5 py-0.5 rounded-md text-xs font-bold border ${prColor}`}>
                          {prLabel}
                        </span>
                        <span className="bg-[#0b0e14] text-slate-300 text-xs px-2.5 py-0.5 rounded-md font-bold">
                          {TYPE_LABELS[String(item.approval_type ?? '')] ?? String(item.approval_type ?? '')}
                        </span>
                      </div>
                      {item.description && <p className="text-[#8b95a7] text-sm mb-2 leading-relaxed whitespace-pre-wrap">{item.description}</p>}
                      <div className="flex items-center gap-4 text-xs text-[#5f6b7e] font-medium">
                        <span className="flex items-center gap-1"><Clock size={14} /> {new Date(String(item.created_at ?? '')).toLocaleString(dir === 'rtl' ? 'ar-SA' : 'en-GB')}</span>
                        {item.expires_at && <span className="text-rose-400 flex items-center gap-1">{ap.expires} {new Date(String(item.expires_at ?? '')).toLocaleDateString(dir === 'rtl' ? 'ar-SA' : 'en-GB')}</span>}
                      </div>
                    </div>
                  </div>
                  
                  {item.status === 'pending' && (
                    <div className="flex gap-2 w-full lg:w-auto shrink-0 border-t lg:border-t-0 lg:border-r border-[#222a36] pt-4 lg:pt-0 lg:pe-5">
                      <button onClick={() => handleActionClick(item, 'approved')}
                        className="flex-1 lg:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white border border-emerald-500/20 font-bold text-sm transition-colors">
                        <CheckCircle size={16} /> {ap.approve}
                      </button>
                      <button onClick={() => handleActionClick(item, 'rejected')}
                        className="flex-1 lg:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white border border-rose-500/20 font-bold text-sm transition-colors">
                        <XCircle size={16} /> {ap.reject}
                      </button>
                    </div>
                  )}
                  
                  {item.status !== 'pending' && (
                    <div className="flex items-center justify-center lg:justify-end w-full lg:w-auto border-t lg:border-t-0 lg:border-r border-[#222a36] pt-4 lg:pt-0 lg:pe-5 shrink-0">
                      <span className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border ${item.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                        {item.status === 'approved' ? <><CheckCircle size={16} /> {ap.approved_done}</> : <><XCircle size={16} /> {ap.rejected_done}</>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div dir={dir} className="bg-[#151a23] border border-[#222a36] rounded-3xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <h3 className="text-xl font-bold text-white mb-1">{ap.plan_title}</h3>
              <p className="text-sm text-[#8b95a7] mb-6">{ap.plan_sub}</p>

              <div className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-slate-200 mb-1.5">{ap.installments_count}</label>
                  <select
                    value={planData.count}
                    onChange={e => setPlanData({ ...planData, count: Number(e.target.value) })}
                    className="w-full bg-[#0d1117] border border-[#222a36] text-slate-100 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#10b981]/30"
                  >
                    {[2,3,4,6,12].map(n => <option key={n} value={n}>{ap.installments_n.replace('{n}', String(n))}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-200 mb-1.5">{ap.payment_period}</label>
                  <select
                    value={planData.frequency}
                    onChange={e => setPlanData({ ...planData, frequency: e.target.value })}
                    className="w-full bg-[#0d1117] border border-[#222a36] text-slate-100 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[#10b981]/30"
                  >
                    <option value="شهري">{ap.monthly}</option>
                    <option value="أسبوعي">{ap.weekly}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-200 mb-1.5">{ap.first_payment}</label>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder={ap.first_payment_eg}
                      value={planData.firstPayment}
                      onChange={e => setPlanData({ ...planData, firstPayment: e.target.value })}
                      className="w-full bg-[#0d1117] border border-[#222a36] text-slate-100 rounded-xl px-4 py-3 pe-12 focus:outline-none focus:ring-2 focus:ring-[#10b981]/30"
                    />
                    <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-[#5f6b7e] font-bold text-sm">
                      SAR
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#0d1117] p-4 border-t border-[#222a36] flex items-center justify-end gap-3">
              <button onClick={() => setPlanModalItem(null)} className="px-5 py-2.5 rounded-xl font-bold text-[#8b95a7] hover:bg-[#222a36] transition-colors">
                {ap.cancel}
              </button>
              <button
                disabled={!planData.firstPayment}
                onClick={() => act(planModalItem.id, 'approved', planData)}
                className="px-6 py-2.5 rounded-xl font-bold bg-[#10b981] text-white hover:bg-[#0e8f68] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {ap.confirm_approve}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
