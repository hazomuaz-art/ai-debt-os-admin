'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SystemAlert, AlertSeverity } from '@/types'
import { BellRing, Check, Info, AlertTriangle, XCircle, AlertOctagon, RefreshCw } from 'lucide-react'

const SEV: Record<AlertSeverity, string> = {
  info:     'bg-blue-50 text-blue-600 border-blue-200',
  warning:  'bg-amber-50 text-amber-600 border-amber-200',
  error:    'bg-orange-50 text-orange-600 border-orange-200',
  critical: 'bg-rose-50 text-rose-600 border-rose-200',
}

const SEV_ARABIC: Record<AlertSeverity, string> = {
  info: 'معلومة',
  warning: 'تحذير',
  error: 'خطأ',
  critical: 'حرج جداً',
}

const SEV_ICONS: Record<AlertSeverity, JSX.Element> = {
  info: <Info size={20} className="text-blue-500" />, 
  warning: <AlertTriangle size={20} className="text-amber-500" />, 
  error: <XCircle size={20} className="text-orange-500" />, 
  critical: <AlertOctagon size={20} className="text-rose-500" />,
}

export default function AlertsPage() {
  const [alerts,  setAlerts]  = useState<SystemAlert[]>([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState<AlertSeverity | 'all'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/modules/alerts')
      const d = await r.json() as { data?: SystemAlert[] }
      setAlerts(d.data ?? [])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  async function markRead(id: string) {
    await fetch('/api/modules/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_read: true }),
    })
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, is_read: true } : a))
  }

  async function resolve(id: string) {
    await fetch('/api/modules/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_resolved: true, resolved_at: new Date().toISOString() }),
    })
    await load()
  }

  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.severity === filter)
  const counts = { critical: 0, error: 0, warning: 0, info: 0 } as Record<AlertSeverity, number>
  for (const a of alerts) counts[a.severity] = (counts[a.severity] ?? 0) + 1

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#f0f4f8] font-sans text-slate-800" >
      
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#e6f0f9] text-[#1e3e50] rounded-xl flex items-center justify-center shrink-0">
            <BellRing size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#1e3e50] mb-1">سجل التنبيهات (System Alerts)</h1>
            <p className="text-slate-500 text-sm">مراقبة صحة النظام، الأخطاء التقنية، وتنبيهات الذكاء الاصطناعي</p>
          </div>
        </div>
        <button onClick={load} className="bg-white hover:bg-slate-50 border border-slate-200 text-[#1e3e50] font-bold text-sm px-4 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-2">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {loading ? 'جاري التحديث...' : 'تحديث السجل'}
        </button>
      </div>

      {/* Severity counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(['critical','error','warning','info'] as AlertSeverity[]).map(sev => (
          <div key={sev} className={`bg-white rounded-2xl border p-5 flex items-center justify-between shadow-sm transition-shadow hover:shadow-md ${SEV[sev].replace('bg-', 'border-').split(' ')[2] || 'border-slate-100'}`}>
            <div>
              <div className="text-slate-500 text-sm font-bold mb-1">{SEV_ARABIC[sev]}</div>
              <div className={`text-3xl font-bold font-mono ${SEV[sev].split(' ')[1]}`}>
                {counts[sev] ?? 0}
              </div>
            </div>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${SEV[sev].split(' ')[0]} ${SEV[sev].split(' ')[1]}`}>
              {SEV_ICONS[sev]}
            </div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-2 flex gap-2 flex-wrap items-center overflow-x-auto">
        <span className="text-slate-400 font-bold text-sm px-2">تصفية حسب:</span>
        {(['all','critical','error','warning','info'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              filter === s
                ? 'bg-[#1e3e50] text-white shadow-sm'
                : 'bg-transparent text-slate-500 hover:bg-slate-50'
            }`}>
            {s === 'all' ? `جميع التنبيهات (${alerts.length})` : `${SEV_ARABIC[s]} (${counts[s] ?? 0})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3e50]"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-16 text-center">
          <div className="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={40} />
          </div>
          <div className="font-bold text-xl text-[#1e3e50] mb-2">لا توجد تنبيهات نشطة حالياً</div>
          <p className="text-slate-500 text-sm">النظام يعمل بشكل ممتاز ومستقر ✅</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(alert => (
            <div key={alert.id}
              className={`bg-white rounded-2xl border shadow-sm transition-all duration-300 ${alert.is_read ? 'opacity-60 bg-slate-50/50 border-slate-100' : SEV[alert.severity].replace('bg-', 'border-').split(' ')[2]}`}>
              <div className="p-5 flex flex-col md:flex-row items-start justify-between gap-4">
                
                <div className="flex items-start gap-4 flex-1">
                  <div className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${SEV[alert.severity].split(' ')[0]}`}>
                    {SEV_ICONS[alert.severity]}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <span className="font-bold text-[#1e3e50] text-base">{alert.title}</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${SEV[alert.severity]}`}>
                        {SEV_ARABIC[alert.severity]}
                      </span>
                      <span className="bg-[#f0f4f8] text-slate-500 text-[10px] font-bold px-2 py-1 rounded-md font-mono">
                        المصدر: {alert.alert_type}
                      </span>
                    </div>
                    
                    {alert.message && (
                      <p className="text-slate-600 text-sm font-medium leading-relaxed bg-[#fcfdfd] border border-slate-100 p-3 rounded-xl mt-2 mb-3">
                        {alert.message}
                      </p>
                    )}
                    
                    <p className="text-slate-400 text-xs font-mono font-bold mt-1" dir="ltr">
                      {new Date(alert.created_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col gap-2 shrink-0 w-full md:w-auto mt-2 md:mt-0 pt-4 md:pt-0 border-t border-slate-100 md:border-0">
                  {!alert.is_read && (
                    <button onClick={() => void markRead(alert.id)}
                      className="flex-1 md:flex-none text-xs font-bold px-4 py-2 rounded-xl bg-white text-slate-500 border border-slate-200 hover:text-[#1e3e50] hover:bg-slate-50 transition-colors">
                      تحديد كمقروء
                    </button>
                  )}
                  <button onClick={() => void resolve(alert.id)}
                    className="flex-1 md:flex-none text-xs font-bold px-4 py-2 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-500 hover:text-white transition-colors flex items-center justify-center gap-1.5">
                    <Check size={14} /> تم الحل
                  </button>
                </div>
                
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
