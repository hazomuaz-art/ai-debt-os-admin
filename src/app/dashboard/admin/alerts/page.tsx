'use client'

import { useState, useEffect, useCallback } from 'react'
import type { SystemAlert, AlertSeverity } from '@/types'
import { BellRing, Check, Info, AlertTriangle, XCircle, AlertOctagon, RefreshCw, Trash2 } from 'lucide-react'

const SEV: Record<AlertSeverity, string> = {
  info:     'bg-blue-500/10 text-blue-400 border-blue-500/20',
  warning:  'bg-amber-500/10 text-amber-400 border-amber-500/20',
  error:    'bg-orange-500/10 text-orange-400 border-orange-500/20',
  critical: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
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

// Real complaint this fixes: the raw machine-readable alert_type
// (snake_case, e.g. "whatsapp_disconnected") was shown as-is, which reads
// as noise/unclear to a non-technical user — translate the known types to
// plain Arabic, falling back to the raw value only for a genuinely unknown
// type so nothing silently disappears.
const ALERT_TYPE_LABELS: Record<string, string> = {
  whatsapp_disconnected: 'انقطاع اتصال واتساب',
  whatsapp_delivery_failure: 'فشل تسليم رسائل واتساب',
  whatsapp_session_broken: 'جلسة واتساب معطوبة',
  unknown_number: 'رسالة من رقم غير معروف',
  payment_received: 'سداد جديد',
  sync_completed: 'مزامنة مكتملة',
  installment_request: 'طلب تقسيط',
  promise_not_recorded: 'وعد سداد لم يُسجَّل',
  outcome_needs_human_review: 'يحتاج مراجعة بشرية',
  unmatched_inbound_message: 'رسالة من رقم غير مرتبط بعميل',
  document_needs_review: 'مستند يحتاج مراجعة إدارية',
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

  // Real complaint this fixes: the page never updated on its own — a new
  // critical alert (e.g. WhatsApp disconnected) only appeared after the
  // user manually clicked "تحديث". Poll every 20s so new alerts surface
  // without any action needed.
  useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), 20_000)
    return () => clearInterval(interval)
  }, [load])

  async function resolve(id: string) {
    setAlerts(prev => prev.filter(a => a.id !== id))
    await fetch('/api/modules/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_resolved: true, resolved_at: new Date().toISOString() }),
    })
  }

  async function remove(id: string) {
    setAlerts(prev => prev.filter(a => a.id !== id))
    await fetch('/api/modules/alerts', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
  }

  async function removeAll() {
    if (!confirm('حذف جميع التنبيهات؟')) return
    setAlerts([])
    await fetch('/api/modules/alerts', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
  }

  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.severity === filter)
  const counts = { critical: 0, error: 0, warning: 0, info: 0 } as Record<AlertSeverity, number>
  for (const a of alerts) counts[a.severity] = (counts[a.severity] ?? 0) + 1

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0">
            <BellRing size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">سجل التنبيهات (System Alerts)</h1>
            <p className="text-[#8b95a7] text-sm">مراقبة صحة النظام، الأخطاء التقنية، وتنبيهات الذكاء الاصطناعي</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="bg-[#151a23] hover:bg-[#1a212c] border border-[#222a36] text-white font-bold text-sm px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> {loading ? 'جاري التحديث...' : 'تحديث'}
          </button>
          {alerts.length > 0 && (
            <button onClick={() => void removeAll()} className="bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-bold text-sm px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2">
              <Trash2 size={16} /> حذف الكل
            </button>
          )}
        </div>
      </div>

      {/* Severity counters */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(['critical','error','warning','info'] as AlertSeverity[]).map(sev => (
          <div key={sev} className={`bg-[#151a23] rounded-2xl border p-5 flex items-center justify-between shadow-sm transition-shadow hover:shadow-md ${SEV[sev].replace('bg-', 'border-').split(' ')[2] || 'border-[#222a36]'}`}>
            <div>
              <div className="text-[#8b95a7] text-sm font-bold mb-1">{SEV_ARABIC[sev]}</div>
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
      <div className="bg-[#151a23] rounded-xl border border-[#222a36] shadow-sm p-2 flex gap-2 flex-wrap items-center overflow-x-auto">
        <span className="text-[#5f6b7e] font-bold text-sm px-2">تصفية حسب:</span>
        {(['all','critical','error','warning','info'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              filter === s
                ? 'bg-[#0e7a54] text-white shadow-sm'
                : 'bg-transparent text-[#8b95a7] hover:bg-[#1a212c]'
            }`}>
            {s === 'all' ? `جميع التنبيهات (${alerts.length})` : `${SEV_ARABIC[s]} (${counts[s] ?? 0})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0e7a54]"></div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-16 text-center">
          <div className="w-20 h-20 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={40} />
          </div>
          <div className="font-bold text-xl text-white mb-2">لا توجد تنبيهات نشطة حالياً</div>
          <p className="text-[#8b95a7] text-sm">النظام يعمل بشكل ممتاز ومستقر ✅</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(alert => (
            <div key={alert.id}
              className={`bg-[#151a23] rounded-2xl border shadow-sm transition-all duration-300 ${alert.is_read ? 'opacity-60 bg-[#222a36]/50 border-[#222a36]' : SEV[alert.severity].replace('bg-', 'border-').split(' ')[2]}`}>
              <div className="p-5 flex flex-col md:flex-row items-start justify-between gap-4">
                
                <div className="flex items-start gap-4 flex-1">
                  <div className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${SEV[alert.severity].split(' ')[0]}`}>
                    {SEV_ICONS[alert.severity]}
                  </div>
                  
                  <div className="flex-1">
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <span className="font-bold text-white text-base">{alert.title}</span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${SEV[alert.severity]}`}>
                        {SEV_ARABIC[alert.severity]}
                      </span>
                      <span className="bg-[#0b0e14] text-[#8b95a7] text-[10px] font-bold px-2 py-1 rounded-md">
                        {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
                      </span>
                    </div>
                    
                    {alert.message && (
                      <p className="text-slate-300 text-sm font-medium leading-relaxed bg-[#0d1117] border border-[#222a36] p-3 rounded-xl mt-2 mb-3">
                        {alert.message}
                      </p>
                    )}
                    
                    <p className="text-[#5f6b7e] text-xs font-mono font-bold mt-1" dir="ltr">
                      {new Date(alert.created_at).toLocaleString('ar-SA', { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </div>

                <div className="flex flex-row md:flex-col gap-2 shrink-0 w-full md:w-auto mt-2 md:mt-0 pt-4 md:pt-0 border-t border-[#222a36] md:border-0">
                  <button onClick={() => void resolve(alert.id)}
                    className="flex-1 md:flex-none text-xs font-bold px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500 hover:text-white transition-colors flex items-center justify-center gap-1.5">
                    <Check size={14} /> تم الحل
                  </button>
                  <button onClick={() => void remove(alert.id)}
                    className="flex-1 md:flex-none text-xs font-bold px-4 py-2 rounded-xl bg-[#151a23] text-[#8b95a7] border border-[#222a36] hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/20 transition-colors flex items-center justify-center gap-1.5">
                    <Trash2 size={14} /> حذف
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
