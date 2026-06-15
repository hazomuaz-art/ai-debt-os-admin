'use client'

import { useState, useEffect } from 'react'
import type { SystemConfig } from '@/types'
import { Settings, ShieldAlert, Cpu, Activity, PowerOff } from 'lucide-react'

const MODE_CONFIG = {
  off:  { label: 'OFF (متوقف)',  desc: 'النظام يعرض التحليلات فقط — لا إرسال، لا اتصال تلقائي',  color: 'bg-[#222a36] text-[#8b95a7] border-[#222a36]',  dot: 'bg-slate-300', icon: PowerOff },
  test: { label: 'TEST (تجريبي)', desc: 'تجربة داخلية — يسجّل ما كان سيحدث بدون إرسال فعلي للعميل',       color: 'bg-amber-50 text-amber-600 border-amber-200', dot: 'bg-amber-400', icon: Activity },
  live: { label: 'LIVE (مباشر)', desc: 'التشغيل الحقيقي — WhatsApp + AI + Calls + Campaigns',    color: 'bg-emerald-50 text-emerald-600 border-emerald-200',  dot: 'bg-emerald-500 animate-pulse', icon: Cpu },
} as const

const MODULE_LABELS: Record<string, { en: string, ar: string }> = {
  smart_rules:         { en: 'Smart Rules Engine', ar: 'محرك القواعد الذكية' },
  ai_memory:           { en: 'AI Memory', ar: 'ذاكرة الذكاء الاصطناعي' },
  behavior_profiles:   { en: 'Customer Behavior Profiles', ar: 'ملفات سلوك العملاء' },
  negotiation_engine:  { en: 'Negotiation Engine', ar: 'محرك التفاوض التلقائي' },
  voice_collector:     { en: 'AI Voice Collector', ar: 'المحصل الصوتي بالذكاء الاصطناعي' },
  omnichannel_timeline:{ en: 'Omnichannel Timeline', ar: 'التسلسل الزمني متعدد القنوات' },
  campaign_engine:     { en: 'Campaign Engine', ar: 'محرك الحملات التسويقية' },
  approval_system:     { en: 'Approval System', ar: 'نظام الموافقات' },
  promise_tracker:     { en: 'Promise-to-Pay Tracker', ar: 'متتبع وعود السداد' },
  knowledge_base:      { en: 'Knowledge Base', ar: 'قاعدة المعرفة' },
  human_handoff:       { en: 'Human Handoff', ar: 'التحويل لموظف بشري' },
  queue_priority:      { en: 'Queue Priority', ar: 'أولوية الطابور' },
}

export default function AutomationPage() {
  const [config, setConfig] = useState<Partial<SystemConfig>>({ automation_mode: 'off' })
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [confirmLive, setConfirmLive] = useState(false)

  useEffect(() => {
    fetch('/api/modules/config')
      .then(r => r.json())
      .then((d: { data?: SystemConfig }) => { if (d.data) setConfig(d.data) })
      .catch(() => {})
  }, [])

  async function save(updates: Partial<SystemConfig>) {
    setSaving(true)
    const next = { ...config, ...updates }
    setConfig(next)
    try {
      await fetch('/api/modules/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  function setMode(mode: 'off' | 'test' | 'live') {
    if (mode === 'live' && !confirmLive) { setConfirmLive(true); return }
    setConfirmLive(false)
    void save({ automation_mode: mode })
  }

  function toggleModule(key: string, val: boolean) {
    const modules = { ...(config.modules ?? {}) as Record<string, boolean>, [key]: val }
    void save({ modules })
  }

  function toggleEmergency(key: keyof SystemConfig) {
    void save({ [key]: !config[key] })
  }

  const mode = (config.automation_mode ?? 'off') as 'off' | 'test' | 'live'
  const mc   = MODE_CONFIG[mode]

  return (
    <div className="flex-1 overflow-y-auto px-8 pb-8 space-y-6 bg-[#0b0e14] font-sans text-slate-100" >
      
      {/* Header */}
      <div className="bg-[#151a23] rounded-2xl p-6 shadow-sm border border-[#222a36] flex items-center justify-between mt-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[#0d1117] text-white rounded-xl flex items-center justify-center shrink-0">
            <Settings size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">إعدادات الأتمتة والتحكم</h1>
            <p className="text-[#8b95a7] text-sm">التحكم في أوضاع التشغيل، إيقاف الطوارئ، وضبط موديولات الذكاء الاصطناعي</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-blue-500 text-sm font-bold bg-blue-50 px-3 py-1 rounded-full animate-pulse">جارٍ الحفظ...</span>}
          {saved  && <span className="text-emerald-500 text-sm font-bold bg-emerald-50 px-3 py-1 rounded-full">✓ تم الحفظ</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (Main Controls) */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Mode selector */}
          <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-4">
              <Cpu className="text-white" size={20} />
              <h2 className="text-lg font-bold text-white">وضع التشغيل الحالي (Mode)</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(['off','test','live'] as const).map(m => {
                const mc2 = MODE_CONFIG[m]
                const isActive = mode === m
                const Icon = mc2.icon
                return (
                  <button key={m}
                    onClick={() => setMode(m)}
                    className={`p-5 rounded-2xl border text-start transition-all flex flex-col gap-3 ${isActive ? `${mc2.color} shadow-sm ring-2 ring-offset-2 ring-${mc2.color.split(' ')[1].replace('text-', '')}` : 'bg-[#0d1117] border-[#222a36] text-[#8b95a7] hover:bg-[#1a212c]'}`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <Icon size={18} />
                        <span className="font-bold text-base">{mc2.label}</span>
                      </div>
                      <div className={`w-3 h-3 rounded-full shadow-sm ${isActive ? mc2.dot : 'bg-slate-200'}`} />
                    </div>
                    <p className={`text-xs leading-relaxed ${isActive ? 'opacity-90' : 'opacity-70'}`}>{mc2.desc}</p>
                  </button>
                )
              })}
            </div>

            {/* Live confirmation */}
            {confirmLive && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 space-y-4 mt-4 animate-in fade-in slide-in-from-top-2">
                <div className="text-emerald-700 font-bold text-sm flex items-center gap-2">
                  <ShieldAlert size={18} />
                  تأكيد تفعيل التشغيل المباشر (LIVE Mode)
                </div>
                <p className="text-emerald-600/80 text-sm">سيبدأ النظام بإرسال رسائل WhatsApp وإجراء اتصالات AI فعلية بالعملاء. تأكد من ضبط الحدود اليومية بشكل صحيح قبل المتابعة.</p>
                <div className="flex gap-3">
                  <button onClick={() => { setConfirmLive(false); void save({ automation_mode: 'live' }) }}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-6 py-2.5 rounded-xl transition-colors shadow-sm">
                    نعم، فعّل النظام المباشر
                  </button>
                  <button onClick={() => setConfirmLive(false)}
                    className="bg-[#151a23] hover:bg-[#1a212c] text-slate-300 border border-[#222a36] font-bold text-sm px-6 py-2.5 rounded-xl transition-colors">
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Module toggles */}
          <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-4">
              <Activity className="text-white" size={20} />
              <h2 className="text-lg font-bold text-white">الوحدات الذكية (Smart Modules)</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(MODULE_LABELS).map(([key, labels]) => {
                const enabled = !!(config.modules as Record<string,boolean> | undefined)?.[key]
                return (
                  <div key={key}
                    className={`flex items-center justify-between p-4 rounded-xl border transition-colors ${
                      enabled
                        ? 'bg-[#0d1117]/50 border-blue-200'
                        : 'bg-[#0d1117] border-[#222a36]'
                    }`}
                  >
                    <div>
                      <div className={`font-bold text-sm ${enabled ? 'text-white' : 'text-[#8b95a7]'}`}>{labels.en}</div>
                      <div className={`text-xs mt-0.5 ${enabled ? 'text-blue-600/70' : 'text-[#5f6b7e]'}`}>{labels.ar}</div>
                    </div>
                    
                    <button 
                      onClick={() => toggleModule(key, !enabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-[#151a23] transition-transform ${enabled ? '-translate-x-6' : '-translate-x-1'}`} />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Right Column (Emergency & Limits) */}
        <div className="space-y-6">
          
          {/* Emergency stops */}
          <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-4">
              <ShieldAlert className="text-rose-500" size={20} />
              <h2 className="text-lg font-bold text-rose-600">أزرار الطوارئ (Emergency Stop)</h2>
            </div>
            
            <div className="flex flex-col gap-3">
              {[
                { key: 'emergency_stop_all' as const,      label: 'إيقاف النظام بالكامل' },
                { key: 'emergency_stop_ai' as const,       label: 'إيقاف الذكاء الاصطناعي فقط' },
                { key: 'emergency_stop_whatsapp' as const, label: 'إيقاف إرسال الواتساب' },
                { key: 'emergency_stop_calls' as const,    label: 'إيقاف المكالمات الصوتية' },
              ].map(({ key, label }) => {
                const isStopped = config[key]
                return (
                  <button key={key}
                    onClick={() => toggleEmergency(key)}
                    className={`p-4 rounded-xl border text-sm font-bold transition-all flex items-center justify-between ${
                      isStopped
                        ? 'bg-rose-50 text-rose-600 border-rose-200 shadow-sm ring-1 ring-rose-200'
                        : 'bg-[#0d1117] text-[#8b95a7] border-[#222a36] hover:bg-[#1a212c]'
                    }`}
                  >
                    <span>{label}</span>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${isStopped ? 'bg-rose-100 text-rose-600' : 'bg-[#222a36] text-[#5f6b7e]'}`}>
                      <PowerOff size={16} />
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Usage limits */}
          <div className="bg-[#151a23] rounded-2xl border border-[#222a36] shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-[#222a36] pb-4">
              <Activity className="text-white" size={20} />
              <h2 className="text-lg font-bold text-white">حدود الاستخدام (Cost Shield)</h2>
            </div>
            
            <div className="flex flex-col gap-4">
              {[
                { key: 'daily_ai_calls_limit' as const,      label: 'الحد الأقصى لاتصالات AI (يومياً)' },
                { key: 'daily_whatsapp_limit' as const,      label: 'الحد الأقصى لرسائل الواتساب (يومياً)' },
                { key: 'daily_call_analysis_limit' as const, label: 'الحد الأقصى لتحليل المكالمات (يومياً)' },
                { key: 'monthly_cost_limit' as const,        label: 'الحد الأقصى للتكلفة الشهرية ($)' },
              ].map(({ key, label }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-xs font-bold text-[#8b95a7] ps-2">{label}</label>
                  <input 
                    type="number" 
                    min="0" 
                    className="w-full bg-[#0b0e14] border-none text-white rounded-xl px-4 py-3 text-sm font-mono font-bold focus:outline-none focus:ring-1 focus:ring-[#0e7a54]"
                    value={String(config[key] ?? '')}
                    onChange={e => setConfig(p => ({ ...p, [key]: Number(e.target.value) }))}
                    onBlur={() => void save({})}
                  />
                </div>
              ))}
            </div>
          </div>
          
        </div>
      </div>
    </div>
  )
}
